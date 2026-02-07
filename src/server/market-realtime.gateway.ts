import { FastifyInstance } from 'fastify';
import WebSocket, { WebSocketServer } from 'ws';
import { MarketDataPubSub } from '../services/market-data/market-pubsub.service.js';
import { MarketDataService } from '../services/market-data/market-data.service.js';
import { TradingViewStreamService } from '../services/market-data/tradingview-stream.service.js';
import { InstrumentRepository } from '../adapters/database/repositories/instrument.repository.js';
import { getLogger } from '../utils/logger.js';
import { NormalizedMarketDataMessage } from '../types/market-data.types.js';

type ClientSubscription = {
  channel: string;
  unsubscribe: () => void;
};

export class MarketRealtimeGateway {
  private wss: WebSocketServer;
  private pubsub: MarketDataPubSub;
  private marketDataService: MarketDataService;
  private tradingViewStream: TradingViewStreamService;
  private instrumentRepo: InstrumentRepository;
  private logger = getLogger();
  private clientSubscriptions = new Map<WebSocket, Map<string, ClientSubscription>>();

  constructor(
    app: FastifyInstance,
    pubsub: MarketDataPubSub,
    marketDataService: MarketDataService,
  ) {
    this.pubsub = pubsub;
    this.marketDataService = marketDataService;
    this.tradingViewStream = new TradingViewStreamService();
    this.instrumentRepo = new InstrumentRepository();
    this.wss = new WebSocketServer({
      server: app.server,
      path: '/ws/markets',
    });

    this.wss.on('connection', (socket) => {
      this.logger.info('Frontend WebSocket connected');
      this.clientSubscriptions.set(socket, new Map());

      socket.on('message', (data) => this.handleClientMessage(socket, data.toString()));
      socket.on('close', () => this.cleanupClient(socket));
      socket.on('error', () => this.cleanupClient(socket));

      socket.send(
        JSON.stringify({
          type: 'connected',
          timestamp: Date.now(),
        }),
      );
    });
  }

  close(): void {
    this.wss.close();
  }

  private handleClientMessage(socket: WebSocket, payload: string): void {
    let message: unknown;
    try {
      message = JSON.parse(payload);
    } catch (error) {
      this.logger.warn({ payload }, 'Failed to parse client message');
      return;
    }

    if (!message || typeof message !== 'object') {
      return;
    }

    const record = message as Record<string, unknown>;
    const type = String(record.type || '');
    const channelType = String(record.channel || '');

    // Check if this is an instrument subscription (new)
    const instrumentId = String(record.instrumentId || '');
    if (instrumentId) {
      if (type === 'subscribe') {
        this.subscribeInstrument(socket, instrumentId, channelType);
        return;
      }
      if (type === 'unsubscribe') {
        this.unsubscribeInstrument(socket, instrumentId, channelType);
        return;
      }
      return;
    }

    // Otherwise, handle as market subscription (existing logic)
    const marketId = String(record.marketId || '');
    const outcome = String(record.outcome || '').toUpperCase();

    if (!marketId || !channelType || (outcome !== 'YES' && outcome !== 'NO')) {
      socket.send(
        JSON.stringify({
          type: 'error',
          code: 'INVALID_SUBSCRIPTION',
          message: 'Invalid subscription parameters',
          details: {
            marketId: marketId || 'missing',
            outcome: outcome || 'missing',
            channelType: channelType || 'missing',
            expected: 'outcome must be "YES" or "NO" for markets, or provide instrumentId',
          },
        }),
      );
      return;
    }

    if (type === 'subscribe') {
      this.subscribe(socket, marketId, outcome, channelType);
      return;
    }

    if (type === 'unsubscribe') {
      this.unsubscribe(socket, marketId, outcome, channelType);
    }
  }

  private subscribe(
    socket: WebSocket,
    marketId: string,
    outcome: string,
    channelType: string,
  ): void {
    const channel = this.channelFor(marketId, channelType);
    if (!channel) {
      return;
    }

    const subscriptions = this.clientSubscriptions.get(socket);
    const subscriptionKey = `${channel}:${outcome}`;
    if (!subscriptions || subscriptions.has(subscriptionKey)) {
      return;
    }

    const unsubscribe = this.pubsub.subscribe(channel, (event: NormalizedMarketDataMessage) => {
      if (event.outcome !== outcome) {
        return;
      }
      socket.send(
        JSON.stringify({
          type: channelType,
          marketId,
          outcome: event.outcome,
          payload: event,
        }),
      );
    });

    subscriptions.set(subscriptionKey, { channel, unsubscribe });

    // Send initial snapshot for orderbook channel
    if (channelType === 'orderbook') {
      this.sendInitialSnapshot(socket, marketId, outcome).catch((err) =>
        this.logger.error({ err, marketId, outcome }, 'Failed to send initial snapshot'),
      );
    }
  }

  private async sendInitialSnapshot(
    socket: WebSocket,
    marketId: string,
    outcome: string,
  ): Promise<void> {
    try {
      const orderbook = await this.marketDataService.getOrderbook(marketId, outcome);
      if (orderbook) {
        socket.send(
          JSON.stringify({
            type: 'orderbook_snapshot',
            marketId,
            outcome,
            payload: orderbook,
          }),
        );
      }
    } catch (error) {
      // Log but don't fail subscription
      this.logger.debug({ error, marketId, outcome }, 'Could not send initial snapshot');
    }
  }

  private unsubscribe(
    socket: WebSocket,
    marketId: string,
    outcome: string,
    channelType: string,
  ): void {
    const channel = this.channelFor(marketId, channelType);
    if (!channel) {
      return;
    }

    const subscriptions = this.clientSubscriptions.get(socket);
    const subscriptionKey = `${channel}:${outcome}`;
    const subscription = subscriptions?.get(subscriptionKey);
    if (!subscription) {
      return;
    }
    subscription.unsubscribe();
    subscriptions?.delete(subscriptionKey);
  }

  private cleanupClient(socket: WebSocket): void {
    const subscriptions = this.clientSubscriptions.get(socket);
    if (subscriptions) {
      subscriptions.forEach((subscription) => subscription.unsubscribe());
      subscriptions.clear();
    }
    this.clientSubscriptions.delete(socket);
  }

  private channelFor(marketId: string, channelType: string): string | null {
    if (channelType === 'orderbook') {
      return `market:${marketId}:orderbook`;
    }
    if (channelType === 'price') {
      return `market:${marketId}:price`;
    }
    return null;
  }

  // ── Instrument subscription handlers ────────────────────────────────────

  private subscribeInstrument(socket: WebSocket, instrumentId: string, channelType: string): void {
    const channel = this.instrumentChannelFor(instrumentId, channelType);
    if (!channel) {
      socket.send(
        JSON.stringify({
          type: 'error',
          code: 'INVALID_CHANNEL',
          message: `Invalid channel type for instrument: ${channelType}`,
        }),
      );
      return;
    }

    const subscriptions = this.clientSubscriptions.get(socket);
    const subscriptionKey = channel;
    if (!subscriptions || subscriptions.has(subscriptionKey)) {
      return;
    }

    // Subscribe to TradingView stream if not already active
    if (!this.tradingViewStream.hasSubscription(instrumentId)) {
      this.startInstrumentStream(instrumentId).catch((err) =>
        this.logger.error({ err, instrumentId }, 'Failed to start instrument stream'),
      );
    }

    // Subscribe to pubsub channel
    const unsubscribe = this.pubsub.subscribe(channel, (event: any) => {
      socket.send(
        JSON.stringify({
          type: channelType,
          instrumentId,
          payload: event,
        }),
      );
    });

    subscriptions.set(subscriptionKey, { channel, unsubscribe });

    this.logger.info({ instrumentId, channel }, 'Client subscribed to instrument channel');
  }

  private async startInstrumentStream(instrumentId: string): Promise<void> {
    const instrument = await this.instrumentRepo.findById(instrumentId);
    if (!instrument) {
      this.logger.warn({ instrumentId }, 'Instrument not found for streaming');
      return;
    }

    this.logger.info({ instrumentId, symbol: instrument.symbol }, 'Starting TradingView stream');

    this.tradingViewStream.subscribeToSymbol(instrumentId, instrument.symbol, (update) => {
      // Publish to pubsub so all connected clients receive it
      const channel = `instrument:${instrumentId}:price`;
      this.pubsub.publish(channel, {
        type: 'price_update',
        price: update.price,
        bidPrice: update.bidPrice,
        askPrice: update.askPrice,
        timestamp: update.timestamp,
      });
    });
  }

  private unsubscribeInstrument(
    socket: WebSocket,
    instrumentId: string,
    channelType: string,
  ): void {
    const channel = this.instrumentChannelFor(instrumentId, channelType);
    if (!channel) {
      return;
    }

    const subscriptions = this.clientSubscriptions.get(socket);
    const subscriptionKey = channel;
    const subscription = subscriptions?.get(subscriptionKey);
    if (!subscription) {
      return;
    }

    subscription.unsubscribe();
    subscriptions?.delete(subscriptionKey);

    this.logger.info({ instrumentId, channel }, 'Client unsubscribed from instrument channel');
  }

  private instrumentChannelFor(instrumentId: string, channelType: string): string | null {
    if (channelType === 'price') {
      return `instrument:${instrumentId}:price`;
    }
    // Future: add 'trades', 'orderbook' if needed
    return null;
  }
}
