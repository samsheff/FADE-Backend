import { MarketRepository } from '../../adapters/database/repositories/market.repository.js';
import { PolymarketClobAdapter } from '../../adapters/polymarket/clob-client.adapter.js';
import { MarketCacheService } from './market-cache.service.js';
import { Market, MarketFilters, MarketListResponse, Orderbook } from '../../types/market.types.js';
import { NotFoundError } from '../../utils/errors.js';
import { getLogger } from '../../utils/logger.js';

export class MarketDataService {
  private marketRepo: MarketRepository;
  private polymarketAdapter: PolymarketClobAdapter;
  private cache: MarketCacheService;
  private logger;

  constructor() {
    this.marketRepo = new MarketRepository();
    this.polymarketAdapter = new PolymarketClobAdapter();
    this.cache = new MarketCacheService();
    this.logger = getLogger();
  }

  async getMarkets(filters: MarketFilters): Promise<MarketListResponse> {
    this.logger.debug({ filters }, 'Getting markets');

    // Fetch from database
    const result = await this.marketRepo.findMany(filters);

    // Cache individual markets
    result.markets.forEach((market) => {
      this.cache.setMarket(market.id, market);
    });

    return result;
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
    const market = await this.marketRepo.findById(id);
    if (!market) {
      throw new NotFoundError('Market', id);
    }

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

    // Get market to find token ID
    const market = await this.getMarketById(marketId);
    const tokenId = market.tokens[outcome];
    if (!tokenId) {
      throw new NotFoundError(`Token for outcome ${outcome} in market`, marketId);
    }

    // Fetch from Polymarket
    const orderbook = await this.polymarketAdapter.fetchOrderbook(tokenId);

    // Cache it
    this.cache.setOrderbook(cacheKey, orderbook);

    return orderbook;
  }

  async syncMarketsFromPolymarket(): Promise<number> {
    this.logger.info('Starting market sync from Polymarket');

    try {
      // Fetch latest markets from Polymarket
      const markets = await this.polymarketAdapter.fetchMarkets({
        active: true,
        limit: 100,
      });

      this.logger.info({ count: markets.length }, 'Fetched markets from Polymarket');

      // Upsert into database
      let updated = 0;
      for (const market of markets) {
        await this.marketRepo.upsert(market);
        this.cache.deleteMarket(market.id); // Invalidate cache
        updated++;
      }

      this.logger.info({ updated }, 'Market sync completed');
      return updated;
    } catch (error) {
      this.logger.error({ error }, 'Market sync failed');
      throw error;
    }
  }
}
