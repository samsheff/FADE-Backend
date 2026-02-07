import { getEnvironment } from '../../config/environment.js';
import { getLogger } from '../../utils/logger.js';
import { ExternalApiError, MarketNotFoundError } from '../../utils/errors.js';
import { Market } from '../../types/market.types.js';
import { Orderbook, OrderbookLevel } from '../../types/market.types.js';

interface PolymarketMarketResponse {
  condition_id: string;
  question: string;
  description: string;
  end_date_iso: string;
  outcomes: string[];
  outcome_prices: string[];
  tokens: Array<{
    outcome: string;
    token_id: string;
  }>;
  volume: string;
  liquidity: string;
  slug: string;
  active: boolean;
  tags?: string[];
}

interface PolymarketOrderbookResponse {
  bids: Array<{
    price: string;
    size: string;
  }>;
  asks: Array<{
    price: string;
    size: string;
  }>;
}

export class PolymarketClobAdapter {
  private baseUrl: string;
  private logger;

  constructor() {
    const env = getEnvironment();
    this.baseUrl = env.POLYMARKET_CLOB_API_URL;
    this.logger = getLogger();
  }

  async fetchMarkets(options?: {
    active?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<Market[]> {
    try {
      const params = new URLSearchParams();
      if (options?.active !== undefined) {
        params.append('active', options.active.toString());
      }
      if (options?.limit) {
        params.append('limit', options.limit.toString());
      }
      if (options?.offset) {
        params.append('offset', options.offset.toString());
      }

      const url = `${this.baseUrl}/markets?${params.toString()}`;
      this.logger.debug({ url }, 'Fetching markets from Polymarket');

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: PolymarketMarketResponse[] = await response.json();

      return data.map((m) => this.toMarket(m));
    } catch (error) {
      this.logger.error({ error }, 'Failed to fetch markets from Polymarket');
      throw new ExternalApiError(
        'Polymarket CLOB',
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  async fetchMarket(conditionId: string): Promise<Market> {
    try {
      const url = `${this.baseUrl}/markets/${conditionId}`;
      this.logger.debug({ url, conditionId }, 'Fetching market from Polymarket');

      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Market ${conditionId} not found`);
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: PolymarketMarketResponse = await response.json();

      return this.toMarket(data);
    } catch (error) {
      this.logger.error({ error, conditionId }, 'Failed to fetch market from Polymarket');
      throw new ExternalApiError(
        'Polymarket CLOB',
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  async fetchOrderbook(tokenId: string): Promise<Orderbook> {
    try {
      const url = `${this.baseUrl}/book?token_id=${tokenId}`;
      this.logger.debug({ url, tokenId }, 'Fetching orderbook from Polymarket');

      const response = await fetch(url);

      if (!response.ok) {
        // Detect 404 specifically - orderbook not found (market likely closed)
        if (response.status === 404) {
          throw new MarketNotFoundError('Orderbook', tokenId, true);
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: PolymarketOrderbookResponse = await response.json();

      return {
        bids: data.bids.map(
          (b): OrderbookLevel => ({
            price: b.price,
            size: b.size,
          }),
        ),
        asks: data.asks.map(
          (a): OrderbookLevel => ({
            price: a.price,
            size: a.size,
          }),
        ),
      };
    } catch (error) {
      // Re-throw MarketNotFoundError without wrapping
      if (error instanceof MarketNotFoundError) {
        throw error;
      }

      this.logger.error({ error, tokenId }, 'Failed to fetch orderbook from Polymarket');
      throw new ExternalApiError(
        'Polymarket CLOB',
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  private toMarket(data: PolymarketMarketResponse): Market {
    // Build tokens map
    const tokens: Record<string, string> = {};
    data.tokens.forEach((t) => {
      tokens[t.outcome] = t.token_id;
    });
    const normalizedOutcomes = data.outcomes.map((outcome) => outcome.toUpperCase());
    const yesIndex = normalizedOutcomes.indexOf('YES');
    const noIndex = normalizedOutcomes.indexOf('NO');

    return {
      id: data.condition_id,
      question: data.question,
      outcomes: data.outcomes,
      expiryDate: new Date(data.end_date_iso),
      liquidity: data.liquidity,
      volume24h: data.volume,
      categoryTag: data.tags?.[0] || null,
      marketSlug: data.slug,
      active: data.active,
      tokens,
      yesPrice: yesIndex >= 0 ? data.outcome_prices[yesIndex] || null : null,
      noPrice: noIndex >= 0 ? data.outcome_prices[noIndex] || null : null,
      createdAt: new Date(),
      lastUpdated: new Date(),
    };
  }
}
