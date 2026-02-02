import { getEnvironment } from '../../config/environment.js';
import { getLogger } from '../../utils/logger.js';
import { RateLimiter } from '../../utils/rate-limiter.js';

export interface HistoricalTrade {
  price: string;
  size: string;
  timestamp: Date;
  conditionId: string;
  outcome: string;
  side: string;
}

interface DataApiTradeResponse {
  price: string;
  size: string;
  timestamp: number;
  market: string;
  asset_id: string;
  side: string;
  outcome?: string;
}

export interface FetchTradesOptions {
  market: string;
  limit?: number;
  offset?: number;
  startTs?: number;
  endTs?: number;
}

export class PolymarketDataApiAdapter {
  private logger;
  private dataApiUrl: string;
  private rateLimiter: RateLimiter;

  constructor() {
    const env = getEnvironment();
    this.logger = getLogger();
    this.dataApiUrl = env.POLYMARKET_DATA_API_URL || 'https://data-api.polymarket.com';
    // Conservative rate limiting: 1 request per second
    this.rateLimiter = new RateLimiter(env.HISTORICAL_BACKFILL_RATE_LIMIT_MS || 1000);
  }

  /**
   * Fetch historical trades from Polymarket Data API
   * @param options - Query parameters for the trades endpoint
   * @returns Array of historical trades
   */
  async fetchTrades(options: FetchTradesOptions): Promise<HistoricalTrade[]> {
    const { market, limit = 10000, offset = 0, startTs, endTs } = options;

    const url = new URL(`${this.dataApiUrl}/trades`);
    url.searchParams.set('market', market);
    url.searchParams.set('limit', limit.toString());
    url.searchParams.set('offset', offset.toString());
    url.searchParams.set('takerOnly', 'true'); // Only get actual executed trades

    if (startTs !== undefined) {
      url.searchParams.set('startTs', startTs.toString());
    }
    if (endTs !== undefined) {
      url.searchParams.set('endTs', endTs.toString());
    }

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Apply rate limiting
        await this.rateLimiter.wait();

        const response = await fetch(url.toString());

        // Handle rate limiting with exponential backoff
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const backoffMs = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : Math.min(2000 * Math.pow(2, attempt), 30000);

          this.logger.warn(
            {
              market,
              attempt: attempt + 1,
              maxRetries: maxRetries + 1,
              backoffMs,
            },
            'Rate limited by Data API, retrying with backoff',
          );

          if (attempt < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            continue;
          }
        }

        if (!response.ok) {
          let bodySnippet = '';
          try {
            const text = await response.text();
            bodySnippet = text.slice(0, 500);
          } catch {
            bodySnippet = '';
          }
          lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
          this.logger.error(
            {
              status: response.status,
              statusText: response.statusText,
              bodySnippet,
              market,
              attempt: attempt + 1,
            },
            'Data API request failed',
          );

          // Only retry on 5xx errors or rate limiting
          if (response.status >= 500 && attempt < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
            continue;
          }

          throw lastError;
        }

        const data = (await response.json()) as DataApiTradeResponse[];

        this.logger.debug(
          {
            market,
            limit,
            offset,
            tradesCount: data.length,
          },
          'Fetched historical trades',
        );

        return data.map((trade) => this.toHistoricalTrade(trade, market));
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < maxRetries) {
          const backoffMs = 1000 * (attempt + 1);
          this.logger.warn(
            {
              error: lastError.message,
              market,
              attempt: attempt + 1,
              maxRetries: maxRetries + 1,
              backoffMs,
            },
            'Error fetching trades, retrying',
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }
      }
    }

    throw lastError || new Error('Failed to fetch historical trades after retries');
  }

  /**
   * Fetch all historical trades for a market with pagination
   * @param market - Market condition ID
   * @returns Array of all historical trades
   */
  async fetchAllTrades(market: string): Promise<HistoricalTrade[]> {
    const allTrades: HistoricalTrade[] = [];
    const batchSize = 10000; // Max allowed by API
    let offset = 0;

    while (true) {
      const trades = await this.fetchTrades({
        market,
        limit: batchSize,
        offset,
      });

      allTrades.push(...trades);

      this.logger.info(
        {
          market,
          offset,
          batchSize: trades.length,
          totalTrades: allTrades.length,
        },
        'Fetched trade batch',
      );

      // If we got fewer trades than the batch size, we've reached the end
      if (trades.length < batchSize) {
        break;
      }

      offset += batchSize;
    }

    return allTrades;
  }

  private toHistoricalTrade(data: DataApiTradeResponse, marketId: string): HistoricalTrade {
    return {
      price: data.price,
      size: data.size,
      timestamp: new Date(data.timestamp * 1000), // Convert Unix timestamp to Date
      conditionId: marketId,
      outcome: data.outcome || this.deriveOutcomeFromAssetId(data.asset_id),
      side: data.side,
    };
  }

  private deriveOutcomeFromAssetId(assetId: string): string {
    // Asset IDs typically end with the outcome indicator
    // This is a fallback if outcome is not provided directly
    // You might need to adjust this based on actual asset ID format
    return assetId.includes('YES') ? 'YES' : 'NO';
  }
}
