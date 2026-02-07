import { MarketRepository } from '../../adapters/database/repositories/market.repository.js';
import { OrderbookEventRepository } from '../../adapters/database/repositories/orderbook-event.repository.js';
import { OrderbookRepository } from '../../adapters/database/repositories/orderbook.repository.js';
import { TradeEventRepository } from '../../adapters/database/repositories/trade-event.repository.js';
import { PolymarketClobAdapter } from '../../adapters/polymarket/clob-client.adapter.js';
import { getEnvironment } from '../../config/environment.js';
import { getLogger } from '../../utils/logger.js';
import { MarketNotFoundError } from '../../utils/errors.js';
import { MarketDataPubSub } from './market-pubsub.service.js';
import { OrderbookState } from './orderbook-state.js';
import { PolymarketCLOBWebSocketClient } from './polymarket-clob-ws.client.js';
import { NormalizedMarketDataMessage, MarketOutcome } from '../../types/market-data.types.js';

type OrderbookKey = `${string}:${MarketOutcome}`;

export class MarketDataStreamService {
  private marketRepo = new MarketRepository();
  private orderbookEventRepo = new OrderbookEventRepository();
  private orderbookRepo = new OrderbookRepository();
  private tradeEventRepo = new TradeEventRepository();
  private clobAdapter = new PolymarketClobAdapter();
  private pubsub: MarketDataPubSub;
  private wsClient: PolymarketCLOBWebSocketClient;
  private logger = getLogger();
  private orderbookStates = new Map<OrderbookKey, OrderbookState>();
  private subscriptionKeys = new Set<OrderbookKey>();
  private refreshTimer: NodeJS.Timeout | null = null;
  private env = getEnvironment();

  constructor(pubsub: MarketDataPubSub) {
    this.pubsub = pubsub;
    const env = getEnvironment();
    const wsUrl =
      env.POLYMARKET_CLOB_WS_URL || 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

    this.wsClient = new PolymarketCLOBWebSocketClient({
      url: wsUrl,
      heartbeatIntervalMs: env.CLOB_WS_HEARTBEAT_MS,
      reconnectBaseMs: env.CLOB_WS_RECONNECT_BASE_MS,
      reconnectMaxMs: env.CLOB_WS_RECONNECT_MAX_MS,
    });
  }

  async start(): Promise<void> {
    this.wsClient.onMessage((message) => {
      this.handleMessage(message).catch((error) => {
        this.logger.error({ error }, 'Failed handling CLOB message');
      });
    });
    this.wsClient.connect();

    // Subscribe to existing markets immediately
    await this.subscribeToActiveMarkets();

    // Periodic refresh (less frequent since we subscribe progressively)
    this.refreshTimer = setInterval(() => {
      this.subscribeToActiveMarkets().catch((error) => {
        this.logger.error({ error }, 'Failed refreshing market subscriptions');
      });
    }, getEnvironment().MARKET_SYNC_INTERVAL_MS);
  }

  async refreshSubscriptions(): Promise<void> {
    await this.subscribeToActiveMarkets();
  }

  stop(): void {
    this.wsClient.disconnect();
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private async subscribeToActiveMarkets(): Promise<void> {
    const markets = await this.marketRepo.findAll();
    const activeMarkets = markets.filter((market) => market.active);

    let subscriptionCount = 0;
    let marketsWithoutTokens = 0;
    let marketsWithoutOrderbooks = 0;
    const marketsToDeactivate: string[] = [];

    for (const market of activeMarkets) {
      let hasAnyToken = false;
      let hasAnyOrderbook = false;
      let missingOrderbookCount = 0;

      for (const outcome of ['YES', 'NO'] as const) {
        const tokenId = market.tokens[outcome];
        if (!tokenId) {
          continue;
        }
        hasAnyToken = true;
        const key = this.orderbookKey(market.id, outcome);

        if (!this.subscriptionKeys.has(key)) {
          // Attempt to seed orderbook - returns false if not found
          const seeded = await this.seedOrderbook(market.id, outcome, tokenId);

          if (!seeded) {
            missingOrderbookCount++;
            this.logger.debug(
              { marketId: market.id.slice(0, 8), outcome },
              'Skipping WebSocket subscription - orderbook unavailable',
            );
            continue; // Skip subscription for this outcome
          }

          hasAnyOrderbook = true;
          this.wsClient.subscribe({
            marketId: market.id,
            outcome,
            tokenId,
          });
          this.subscriptionKeys.add(key);
          subscriptionCount++;
        } else {
          hasAnyOrderbook = true; // Already subscribed
        }
      }

      if (!hasAnyToken) {
        marketsWithoutTokens++;
        if (marketsWithoutTokens <= 3) {
          this.logger.warn(
            {
              marketId: market.id.slice(0, 8),
              question: market.question.slice(0, 50),
              tokens: market.tokens,
            },
            'Market has no token IDs, skipping WebSocket subscription',
          );
        }
      } else if (!hasAnyOrderbook && missingOrderbookCount > 0) {
        // Market has tokens but no orderbooks - likely closed
        marketsWithoutOrderbooks++;

        // Optional: mark as inactive in database
        if (this.env.AUTO_DEACTIVATE_CLOSED_MARKETS) {
          marketsToDeactivate.push(market.id);
        }
      }
    }

    // Batch update market status
    if (marketsToDeactivate.length > 0) {
      this.logger.info(
        { count: marketsToDeactivate.length },
        'Marking markets as inactive due to missing orderbooks',
      );

      for (const marketId of marketsToDeactivate) {
        try {
          await this.marketRepo.update(marketId, { active: false });
        } catch (error) {
          this.logger.warn({ error, marketId }, 'Failed to deactivate market');
        }
      }
    }

    if (subscriptionCount > 0) {
      this.logger.info(
        {
          totalMarkets: activeMarkets.length,
          newSubscriptions: subscriptionCount,
          totalSubscriptions: this.subscriptionKeys.size,
          skippedNoTokens: marketsWithoutTokens,
          skippedNoOrderbooks: marketsWithoutOrderbooks,
        },
        'WebSocket subscriptions updated',
      );
    } else if (marketsWithoutTokens > 0 || marketsWithoutOrderbooks > 0) {
      this.logger.debug(
        {
          totalMarkets: activeMarkets.length,
          totalSubscriptions: this.subscriptionKeys.size,
          skippedNoTokens: marketsWithoutTokens,
          skippedNoOrderbooks: marketsWithoutOrderbooks,
        },
        'No new markets to subscribe to',
      );
    }
  }

  private async seedOrderbook(
    marketId: string,
    outcome: MarketOutcome,
    tokenId: string,
  ): Promise<boolean> {
    try {
      const snapshot = await this.clobAdapter.fetchOrderbook(tokenId);
      const state = new OrderbookState();
      state.seed(snapshot.bids, snapshot.asks);
      this.orderbookStates.set(this.orderbookKey(marketId, outcome), state);

      this.logger.debug(
        {
          marketId: marketId.slice(0, 8),
          outcome,
          bidLevels: snapshot.bids.length,
          askLevels: snapshot.asks.length,
        },
        'Seeded orderbook with full depth',
      );

      // Persist snapshot for API cache
      await this.orderbookRepo.upsertSnapshot({
        marketId,
        outcome,
        bids: snapshot.bids,
        asks: snapshot.asks,
        expiresAt: new Date(Date.now() + this.env.ORDERBOOK_SNAPSHOT_TTL_MS),
      });

      await this.orderbookEventRepo.insert({
        marketId,
        outcome,
        bestBid: state.getBestBid(),
        bestAsk: state.getBestAsk(),
        midPrice: state.getMidPrice(),
        timestamp: new Date(),
      });

      return true; // Success
    } catch (error) {
      // Handle market not found (404) - expected for closed markets
      if (error instanceof MarketNotFoundError) {
        this.logger.info(
          { marketId: marketId.slice(0, 8), outcome, tokenId: tokenId.slice(0, 8) },
          'Orderbook not found in CLOB API - market likely closed or removed',
        );
        return false;
      }

      // Other errors (network, rate limit, etc.) - unexpected
      this.logger.warn({ error, marketId, outcome }, 'Failed to seed orderbook snapshot');
      return false; // Conservative: skip subscription on any error
    }
  }

  private async handleMessage(message: NormalizedMarketDataMessage): Promise<void> {
    if (message.type === 'trade') {
      await this.tradeEventRepo.insert({
        marketId: message.marketId,
        outcome: message.outcome,
        price: message.price as string,
        size: message.size as string,
        timestamp: message.timestamp,
      });

      this.pubsub.publish(`market:${message.marketId}:price`, message);
      return;
    }

    const key = this.orderbookKey(message.marketId, message.outcome);
    let state = this.orderbookStates.get(key);

    if (message.type === 'orderbook_update' && message.side && message.price) {
      if (!state) {
        state = new OrderbookState();
        this.orderbookStates.set(key, state);
      }
      if (message.snapshot === 'start') {
        state = new OrderbookState();
        this.orderbookStates.set(key, state);
      }
      state.applyDelta(message.side, message.price, message.size || '0');
      const event = {
        type: 'orderbook_update' as const,
        marketId: message.marketId,
        outcome: message.outcome,
        bestBid: state.getBestBid(),
        bestAsk: state.getBestAsk(),
        midPrice: state.getMidPrice(),
        timestamp: message.timestamp,
      };

      if (!message.snapshot || message.snapshot === 'end') {
        await this.orderbookEventRepo.insert({
          marketId: event.marketId,
          outcome: event.outcome,
          bestBid: event.bestBid,
          bestAsk: event.bestAsk,
          midPrice: event.midPrice,
          timestamp: event.timestamp,
        });
      }

      this.pubsub.publish(`market:${message.marketId}:orderbook`, {
        ...message,
        bestBid: event.bestBid || undefined,
        bestAsk: event.bestAsk || undefined,
        midPrice: event.midPrice || undefined,
      });
      this.pubsub.publish(`market:${message.marketId}:price`, {
        type: 'price_update',
        marketId: message.marketId,
        outcome: message.outcome,
        midPrice: event.midPrice || undefined,
        bestBid: event.bestBid || undefined,
        bestAsk: event.bestAsk || undefined,
        timestamp: event.timestamp,
      });
      return;
    }

    if (message.type === 'price_update' || message.type === 'orderbook_update') {
      const bestBid = message.bestBid || (state ? state.getBestBid() : null);
      const bestAsk = message.bestAsk || (state ? state.getBestAsk() : null);
      const midPrice =
        message.midPrice ||
        (bestBid && bestAsk ? ((Number(bestBid) + Number(bestAsk)) / 2).toString() : null);

      await this.orderbookEventRepo.insert({
        marketId: message.marketId,
        outcome: message.outcome,
        bestBid: bestBid,
        bestAsk: bestAsk,
        midPrice: midPrice,
        timestamp: message.timestamp,
      });

      this.pubsub.publish(`market:${message.marketId}:price`, {
        type: 'price_update',
        marketId: message.marketId,
        outcome: message.outcome,
        midPrice: midPrice || undefined,
        bestBid: bestBid || undefined,
        bestAsk: bestAsk || undefined,
        timestamp: message.timestamp,
      });
    }
  }

  private orderbookKey(marketId: string, outcome: MarketOutcome): OrderbookKey {
    return `${marketId}:${outcome}`;
  }
}
