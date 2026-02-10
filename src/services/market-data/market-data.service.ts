import { MarketRepository } from '../../adapters/database/repositories/market.repository.js';
import { OrderbookRepository } from '../../adapters/database/repositories/orderbook.repository.js';
import { PolymarketClobAdapter } from '../../adapters/polymarket/clob-client.adapter.js';
import { MarketCacheService } from './market-cache.service.js';
import {
  Market,
  MarketFilters,
  MarketListResponse,
  MarketRecord,
  MarketSearchFilters,
  Orderbook,
} from '../../types/market.types.js';
import { NotFoundError, ValidationError, MarketNotFoundError } from '../../utils/errors.js';
import { getLogger } from '../../utils/logger.js';
import { getEnvironment } from '../../config/environment.js';
import { aggregateOrderbookDepth } from '../../utils/orderbook-aggregator.js';

export class MarketDataService {
  private marketRepo: MarketRepository;
  private orderbookRepo: OrderbookRepository;
  private cache: MarketCacheService;
  private clobAdapter: PolymarketClobAdapter;
  private env;
  private logger;

  constructor() {
    this.marketRepo = new MarketRepository();
    this.orderbookRepo = new OrderbookRepository();
    this.cache = new MarketCacheService();
    this.clobAdapter = new PolymarketClobAdapter();
    this.env = getEnvironment();
    this.logger = getLogger();
  }

  async getMarkets(filters: MarketFilters): Promise<MarketListResponse> {
    this.logger.debug({ filters }, 'Getting markets');

    // Fetch from database
    const result = await this.marketRepo.findMany(filters);
    const markets = result.markets.map((market) => this.toPublicMarket(market));

    // Cache individual markets
    markets.forEach((market) => {
      this.cache.setMarket(market.id, market);
    });

    return { markets, total: result.total };
  }

  async searchMarkets(filters: MarketSearchFilters): Promise<MarketListResponse> {
    const trimmedQuery = filters.query.trim();
    if (!trimmedQuery) {
      return this.getMarkets({
        active: filters.active,
        expiresAfter: filters.expiresAfter,
        limit: filters.limit,
        offset: filters.offset,
      });
    }

    this.logger.debug({ filters }, 'Searching markets');

    const result = await this.marketRepo.searchMarkets({
      query: trimmedQuery,
      limit: filters.limit,
      offset: filters.offset,
      active: filters.active,
      expiresAfter: filters.expiresAfter,
    });

    const markets = result.markets.map((market) => this.toPublicMarket(market));

    markets.forEach((market) => {
      this.cache.setMarket(market.id, market);
    });

    return { markets, total: result.total };
  }

  async getMarketById(id: string): Promise<Market> {
    this.logger.debug({ id }, 'Getting market by ID');

    // Check cache first
    const cached = this.cache.getMarket(id);
    if (cached) {
      this.logger.debug({ id }, 'Market found in cache');
      return cached;
    }

    // Fetch from database
    const record = await this.marketRepo.findById(id);
    if (!record) {
      throw new NotFoundError('Market', id);
    }

    const market = this.toPublicMarket(record);

    // Cache it
    this.cache.setMarket(id, market);

    return market;
  }

  async getOrderbook(
    marketId: string,
    outcome: string,
    options?: { aggregate?: boolean; bucketSize?: number },
  ): Promise<Orderbook> {
    this.logger.debug({ marketId, outcome }, 'Getting orderbook');

    // Check cache first
    const cacheKey = this.cache.getOrderbookKey(marketId, outcome);
    const cached = this.cache.getOrderbook(cacheKey);
    if (cached) {
      this.logger.debug({ marketId, outcome }, 'Orderbook found in cache');
      return this.applyAggregation(cached, options);
    }

    const snapshot = await this.orderbookRepo.findFreshSnapshot(
      marketId,
      outcome,
      new Date(),
    );

    if (snapshot) {
      const orderbook = { bids: snapshot.bids, asks: snapshot.asks };
      this.cache.setOrderbook(cacheKey, orderbook);
      return this.applyAggregation(orderbook, options);
    }

    const record = await this.marketRepo.findById(marketId);
    if (!record) {
      throw new NotFoundError('Market', marketId);
    }

    const tokenId = record.tokens[outcome];
    if (!tokenId) {
      if (this.env.NODE_ENV !== 'production') {
        const orderbook = this.buildSyntheticOrderbook(record, outcome);
        this.cache.setOrderbook(cacheKey, orderbook);
        return this.applyAggregation(orderbook, options);
      }
      throw new ValidationError(`Token ID not found for outcome ${outcome}`);
    }

    try {
      const orderbook = await this.clobAdapter.fetchOrderbook(tokenId);

      const expiresAt = new Date(Date.now() + this.env.ORDERBOOK_SNAPSHOT_TTL_MS);
      await this.orderbookRepo.upsertSnapshot({
        marketId,
        outcome,
        bids: orderbook.bids,
        asks: orderbook.asks,
        expiresAt,
      });

      this.cache.setOrderbook(cacheKey, orderbook);
      return this.applyAggregation(orderbook, options);
    } catch (error) {
      // Handle market closure (404 from CLOB API)
      if (error instanceof MarketNotFoundError) {
        await this.markMarketClosed(marketId);
        this.logger.info({ marketId, outcome }, 'Market closed - orderbook no longer available in CLOB API');

        // In dev mode, return synthetic orderbook for testing
        if (this.env.NODE_ENV !== 'production') {
          const orderbook = this.buildSyntheticOrderbook(record, outcome);
          this.cache.setOrderbook(cacheKey, orderbook);
          return this.applyAggregation(orderbook, options);
        }

        throw error; // Re-throw in production
      }

      // Other errors (network, rate limit, etc.)
      this.logger.error({ error, marketId, outcome }, 'Failed to fetch orderbook from CLOB');

      if (this.env.NODE_ENV !== 'production') {
        const orderbook = this.buildSyntheticOrderbook(record, outcome);
        this.cache.setOrderbook(cacheKey, orderbook);
        return this.applyAggregation(orderbook, options);
      }

      throw error;
    }
  }

  private applyAggregation(
    orderbook: Orderbook,
    options?: { aggregate?: boolean; bucketSize?: number },
  ): Orderbook {
    if (!options?.aggregate) {
      return orderbook;
    }

    return {
      bids: aggregateOrderbookDepth(orderbook.bids, options.bucketSize),
      asks: aggregateOrderbookDepth(orderbook.asks, options.bucketSize),
    };
  }

  private toPublicMarket(record: MarketRecord): Market {
    return {
      id: record.id,
      question: record.question,
      outcomes: record.outcomes,
      expiryDate: record.expiryDate,
      liquidity: record.liquidity,
      volume24h: record.volume24h,
      categoryTag: record.categoryTag,
      marketSlug: record.marketSlug,
      active: record.active,
      tokens: record.tokens,
      yesPrice: record.yesPrice ?? null,
      noPrice: record.noPrice ?? null,
      createdAt: record.createdAt,
      lastUpdated: record.lastUpdated,
    };
  }

  private async markMarketClosed(marketId: string): Promise<void> {
    try {
      await this.marketRepo.update(marketId, { active: false });
    } catch (error) {
      this.logger.warn({ error, marketId }, 'Failed to mark market as closed');
    }
  }

  private buildSyntheticOrderbook(record: MarketRecord, outcome: string): Orderbook {
    const price =
      outcome.toUpperCase() === 'YES' ? record.yesPrice : record.noPrice;
    if (!price) {
      return { bids: [], asks: [] };
    }

    const size = record.liquidity || '0';

    return {
      bids: [{ price, size }],
      asks: [{ price, size }],
    };
  }
}
