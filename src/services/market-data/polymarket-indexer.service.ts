import { MarketRepository } from '../../adapters/database/repositories/market.repository.js';
import { OrderbookRepository } from '../../adapters/database/repositories/orderbook.repository.js';
import { PolymarketAdapter } from '../../adapters/polymarket/polymarket.adapter.js';
import { MarketCacheService } from './market-cache.service.js';
import { MarketRecord, Orderbook } from '../../types/market.types.js';
import { getEnvironment } from '../../config/environment.js';
import { getLogger } from '../../utils/logger.js';
import type { MarketDataStreamService } from './market-data-stream.service.js';
import type { HistoricalMarketDataSync } from './historical-sync.service.js';

interface SyncResult {
  marketsProcessed: number;
  marketsUpdated: number;
  marketsSkipped: number;
  errors: number;
}

export class PolymarketIndexer {
  private adapter: PolymarketAdapter;
  private marketRepo: MarketRepository;
  private orderbookRepo: OrderbookRepository;
  private cache: MarketCacheService;
  private env;
  private logger;
  private readonly syncConcurrency = 2;
  private readonly batchDelayMs = 1000;
  private streamService: MarketDataStreamService | null = null;
  private historicalSync: HistoricalMarketDataSync | null = null;

  constructor() {
    this.adapter = new PolymarketAdapter();
    this.marketRepo = new MarketRepository();
    this.orderbookRepo = new OrderbookRepository();
    this.cache = new MarketCacheService();
    this.logger = getLogger();
    this.env = getEnvironment();
  }

  setStreamService(streamService: MarketDataStreamService): void {
    this.streamService = streamService;
  }

  setHistoricalSync(historicalSync: HistoricalMarketDataSync): void {
    this.historicalSync = historicalSync;
  }

  async fullSync(): Promise<SyncResult> {
    const result: SyncResult = {
      marketsProcessed: 0,
      marketsUpdated: 0,
      marketsSkipped: 0,
      errors: 0,
    };

    this.logger.info('📥 Fetching all markets from Polymarket...');
    let markets: ReturnType<PolymarketAdapter['getAllMarkets']>;
    try {
      markets = await this.adapter.getAllMarkets();
      this.logger.info({ count: markets.length }, '✅ Fetched markets from Polymarket');
    } catch (error) {
      this.logger.error({ error }, 'Full sync failed fetching markets');
      result.errors += 1;
      return result;
    }

    if (markets.length === 0) {
      this.logger.warn('⚠️  No markets returned from Polymarket API');
      return result;
    }

    this.logger.info({ total: markets.length }, '🔄 Starting market state sync...');
    const currentBlock = await this.safeCurrentBlock();

    await this.processInBatches(markets, async (market) => {
      result.marketsProcessed += 1;
      try {
        const existing = await this.marketRepo.findById(market.id);
        const state = await this.safeMarketState(market.id);

        const upsertPayload = this.mergeMarketRecord(existing, market, state, currentBlock);
        await this.marketRepo.upsert(upsertPayload);

        // Trigger backfill for new markets (don't block)
        if (!existing && this.historicalSync) {
          this.historicalSync.backfillNewMarkets([market.id]).catch((error) => {
            this.logger.warn({ error, marketId: market.id }, 'Backfill failed');
          });
        }

        // Synthetic orderbooks disabled - real orderbooks come from WebSocket stream
        // if (this.env.NODE_ENV !== 'production') {
        //   await this.upsertSyntheticOrderbook(market.id, market.outcomes, upsertPayload);
        // }
        this.invalidateCache(market.id, market.outcomes);

        result.marketsUpdated += 1;
      } catch (error) {
        result.errors += 1;
        this.logger.error({ error, marketId: market.id }, 'Failed to sync market');
      }
    });

    return result;
  }

  async incrementalSync(): Promise<SyncResult> {
    const result: SyncResult = {
      marketsProcessed: 0,
      marketsUpdated: 0,
      marketsSkipped: 0,
      errors: 0,
    };

    const markets = await this.marketRepo.findAll();
    const currentBlock = await this.safeCurrentBlock();

    await this.processInBatches(markets, async (market) => {
      result.marketsProcessed += 1;
      try {
        const state = await this.safeMarketState(market.id);
        const shouldUpdate = this.shouldUpdateMarket(market, state);

        if (!shouldUpdate) {
          result.marketsSkipped += 1;
          return;
        }

        const upsertPayload = this.mergeMarketRecord(market, null, state, currentBlock);
        await this.marketRepo.upsert(upsertPayload);

        // Synthetic orderbooks disabled - real orderbooks come from WebSocket stream
        // if (this.env.NODE_ENV !== 'production') {
        //   await this.upsertSyntheticOrderbook(market.id, market.outcomes, upsertPayload);
        // }
        this.invalidateCache(market.id, market.outcomes);

        result.marketsUpdated += 1;
      } catch (error) {
        result.errors += 1;
        this.logger.error({ error, marketId: market.id }, 'Failed to sync market state');
      }
    });

    return result;
  }

  private async safeCurrentBlock(): Promise<bigint> {
    try {
      return await this.adapter.getCurrentBlockNumber();
    } catch (error) {
      this.logger.error({ error }, 'Failed to fetch current block number');
      return 0n;
    }
  }

  private async safeMarketState(marketId: string): Promise<{
    yesPrice: string | null;
    noPrice: string | null;
    liquidity: string | null;
    volume: string | null;
    lastUpdatedBlock: string | null;
  }> {
    try {
      return await this.adapter.getMarketState(marketId);
    } catch (error) {
      this.logger.error({ error, marketId }, 'Failed to fetch market state');
      return {
        yesPrice: null,
        noPrice: null,
        liquidity: null,
        volume: null,
        lastUpdatedBlock: null,
      };
    }
  }

  private async processInBatches<T>(
    items: T[],
    handler: (item: T) => Promise<void>,
  ): Promise<void> {
    const totalBatches = Math.ceil(items.length / this.syncConcurrency);
    for (let i = 0; i < items.length; i += this.syncConcurrency) {
      const batch = items.slice(i, i + this.syncConcurrency);
      const batchNum = Math.floor(i / this.syncConcurrency) + 1;

      // Log progress every 5 batches or on first/last batch
      if (batchNum === 1 || batchNum === totalBatches || batchNum % 5 === 0) {
        const processed = Math.min(i + this.syncConcurrency, items.length);
        this.logger.info(
          {
            batch: batchNum,
            total: totalBatches,
            processed,
            totalItems: items.length,
            progress: `${Math.round((processed / items.length) * 100)}%`,
          },
          'Processing market batch',
        );
      }

      await Promise.all(batch.map((item) => handler(item)));

      // Subscribe to newly indexed markets immediately
      if (this.streamService) {
        await this.streamService.refreshSubscriptions();
      }

      if (this.batchDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.batchDelayMs));
      }
    }
  }

  private shouldUpdateMarket(market: MarketRecord, state: PolymarketMarketState): boolean {
    if (!state.lastUpdatedBlock) {
      return true;
    }
    if (!market.lastIndexedBlock) {
      return true;
    }

    try {
      return BigInt(state.lastUpdatedBlock) > BigInt(market.lastIndexedBlock);
    } catch {
      return true;
    }
  }

  private mergeMarketRecord(
    existing: MarketRecord | null,
    incoming: {
      id: string;
      polymarketMarketId: string | null;
      question: string;
      outcomes: string[];
      expiryDate: Date;
      marketSlug: string;
      categoryTag: string | null;
      active: boolean;
      tokens: Record<string, string>;
    } | null,
    state: {
      yesPrice: string | null;
      noPrice: string | null;
      liquidity: string | null;
      volume: string | null;
      lastUpdatedBlock: string | null;
    },
    currentBlock: bigint,
  ): Omit<MarketRecord, 'createdAt' | 'lastUpdated'> {
    const base = existing || ({} as MarketRecord);
    const source = incoming || base;

    return {
      id: source.id,
      question: source.question || base.question || 'Unknown market',
      outcomes:
        source.outcomes && source.outcomes.length > 0
          ? source.outcomes
          : base.outcomes || [],
      expiryDate: source.expiryDate || base.expiryDate || new Date(0),
      liquidity: state.liquidity || base.liquidity || '0',
      volume24h: base.volume24h || '0',
      categoryTag: source.categoryTag ?? base.categoryTag ?? null,
      marketSlug: source.marketSlug || base.marketSlug || source.id,
      active: source.active ?? base.active ?? true,
      tokens: Object.keys(source.tokens || {}).length > 0 ? source.tokens : base.tokens || {},
      polymarketMarketId: source.polymarketMarketId ?? base.polymarketMarketId ?? null,
      yesPrice: state.yesPrice ?? base.yesPrice ?? null,
      noPrice: state.noPrice ?? base.noPrice ?? null,
      volume: state.volume ?? base.volume ?? null,
      lastIndexedBlock: state.lastUpdatedBlock || currentBlock.toString(),
    };
  }

  private async upsertSyntheticOrderbook(
    marketId: string,
    outcomes: string[],
    market: Omit<MarketRecord, 'createdAt' | 'lastUpdated'>,
  ): Promise<void> {
    const env = getEnvironment();
    const expiresAt = new Date(Date.now() + env.ORDERBOOK_SNAPSHOT_TTL_MS);

    for (const outcome of outcomes) {
      const orderbook = this.buildSyntheticOrderbook(market, outcome);
      await this.orderbookRepo.upsertSnapshot({
        marketId,
        outcome,
        bids: orderbook.bids,
        asks: orderbook.asks,
        expiresAt,
      });
    }
  }

  private buildSyntheticOrderbook(
    market: Omit<MarketRecord, 'createdAt' | 'lastUpdated'>,
    outcome: string,
  ): Orderbook {
    const price = outcome.toUpperCase() === 'YES' ? market.yesPrice : market.noPrice;
    if (!price) {
      return { bids: [], asks: [] };
    }

    const size = market.liquidity || '0';

    return {
      bids: [{ price, size }],
      asks: [{ price, size }],
    };
  }

  private invalidateCache(marketId: string, outcomes: string[]): void {
    this.cache.deleteMarket(marketId);
    outcomes.forEach((outcome) => {
      const key = this.cache.getOrderbookKey(marketId, outcome);
      this.cache.deleteOrderbook(key);
    });
  }
}

interface PolymarketMarketState {
  yesPrice: string | null;
  noPrice: string | null;
  liquidity: string | null;
  volume: string | null;
  lastUpdatedBlock: string | null;
}
