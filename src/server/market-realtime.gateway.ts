import { FastifyInstance } from 'fastify';
import WebSocket, { WebSocketServer } from 'ws';
import { MarketDataPubSub } from '../services/market-data/market-pubsub.service.js';
import { MarketDataService } from '../services/market-data/market-data.service.js';
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
  private logger = getLogger();
  private clientSubscriptions = new Map<WebSocket, Map<string, ClientSubscription>>();

  constructor(
    app: FastifyInstance,
    pubsub: MarketDataPubSub,
    marketDataService: MarketDataService,
  ) {
    this.pubsub = pubsub;
    this.marketDataService = marketDataService;
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
    const marketId = String(record.marketId || '');
    const outcome = String(record.outcome || '').toUpperCase();
    const channelType = String(record.channel || '');

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
            expected: 'outcome must be "YES" or "NO"',
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
}
