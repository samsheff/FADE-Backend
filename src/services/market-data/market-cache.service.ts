import { LRUCache } from 'lru-cache';
import { getEnvironment } from '../../config/environment.js';
import { Market, Orderbook } from '../../types/market.types.js';

export class MarketCacheService {
  private marketCache: LRUCache<string, Market>;
  private orderbookCache: LRUCache<string, Orderbook>;

  constructor() {
    const env = getEnvironment();

    this.marketCache = new LRUCache<string, Market>({
      max: 500, // Cache up to 500 markets
      ttl: env.MARKET_CACHE_TTL_MS,
    });

    this.orderbookCache = new LRUCache<string, Orderbook>({
      max: 1000, // Cache up to 1000 orderbooks
      ttl: env.ORDERBOOK_CACHE_TTL_MS,
    });
  }

  // Market cache methods
  getMarket(marketId: string): Market | undefined {
    return this.marketCache.get(marketId);
  }

  setMarket(marketId: string, market: Market): void {
    this.marketCache.set(marketId, market);
  }

  deleteMarket(marketId: string): void {
    this.marketCache.delete(marketId);
  }

  clearMarkets(): void {
    this.marketCache.clear();
  }

  // Orderbook cache methods
  getOrderbook(key: string): Orderbook | undefined {
    return this.orderbookCache.get(key);
  }

  setOrderbook(key: string, orderbook: Orderbook): void {
    this.orderbookCache.set(key, orderbook);
  }

  deleteOrderbook(key: string): void {
    this.orderbookCache.delete(key);
  }

  clearOrderbooks(): void {
    this.orderbookCache.clear();
  }

  // Generate orderbook cache key
  getOrderbookKey(marketId: string, outcome: string): string {
    return `${marketId}:${outcome}`;
  }
}
