import { MarketRepository } from '../../adapters/database/repositories/market.repository.js';
import { OrderbookRepository } from '../../adapters/database/repositories/orderbook.repository.js';
import { MarketCacheService } from './market-cache.service.js';
import {
  Market,
  MarketFilters,
  MarketListResponse,
  MarketRecord,
  Orderbook,
} from '../../types/market.types.js';
import { NotFoundError } from '../../utils/errors.js';
import { getLogger } from '../../utils/logger.js';

export class MarketDataService {
  private marketRepo: MarketRepository;
  private orderbookRepo: OrderbookRepository;
  private cache: MarketCacheService;
  private logger;

  constructor() {
    this.marketRepo = new MarketRepository();
    this.orderbookRepo = new OrderbookRepository();
    this.cache = new MarketCacheService();
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

  async getOrderbook(marketId: string, outcome: string): Promise<Orderbook> {
    this.logger.debug({ marketId, outcome }, 'Getting orderbook');

    // Check cache first
    const cacheKey = this.cache.getOrderbookKey(marketId, outcome);
    const cached = this.cache.getOrderbook(cacheKey);
    if (cached) {
      this.logger.debug({ marketId, outcome }, 'Orderbook found in cache');
      return cached;
    }

    const snapshot = await this.orderbookRepo.findFreshSnapshot(
      marketId,
      outcome,
      new Date(),
    );

    if (snapshot) {
      const orderbook = { bids: snapshot.bids, asks: snapshot.asks };
      this.cache.setOrderbook(cacheKey, orderbook);
      return orderbook;
    }

    const record = await this.marketRepo.findById(marketId);
    if (!record) {
      throw new NotFoundError('Market', marketId);
    }

    const orderbook = this.buildSyntheticOrderbook(record, outcome);

    // Cache it
    this.cache.setOrderbook(cacheKey, orderbook);

    return orderbook;
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
      createdAt: record.createdAt,
      lastUpdated: record.lastUpdated,
    };
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
