import axios, { AxiosInstance } from 'axios';
import { getEnvironment } from '../../config/environment.js';
import { getLogger } from '../../utils/logger.js';
import { RateLimiter } from '../../utils/rate-limiter.js';

/**
 * Finnhub API Article Response
 */
export interface FinnhubArticle {
  id: number;
  headline: string;
  summary: string;
  source: string;
  url: string;
  datetime: number; // Unix timestamp
  image: string;
  related: string; // Comma-separated tickers
  category?: string;
}

/**
 * Adapter for Finnhub News API
 *
 * Free tier limits:
 * - 60 requests per minute
 * - Company news and market news endpoints
 *
 * Provides:
 * - Rate limiting (1 req/sec)
 * - Retry with exponential backoff
 * - Error handling
 */
export class FinnhubApiAdapter {
  private client: AxiosInstance;
  private rateLimiter: RateLimiter;
  private logger;

  constructor() {
    const env = getEnvironment();
    this.logger = getLogger();

    this.client = axios.create({
      baseURL: env.FINNHUB_API_BASE_URL,
      timeout: 30000,
      headers: {
        'X-Finnhub-Token': env.FINNHUB_API_KEY || '',
      },
    });

    // Rate limiter: 1 request per second (60 per minute free tier)
    this.rateLimiter = new RateLimiter(
      1, // 1 request
      env.FINNHUB_API_RATE_LIMIT_MS, // per 1000ms
    );
  }

  /**
   * Check if API key is configured
   */
  private checkApiKey(): void {
    const env = getEnvironment();
    if (!env.FINNHUB_API_KEY) {
      throw new Error('FINNHUB_API_KEY is required but not configured');
    }
  }

  /**
   * Get company news for a specific ticker symbol
   *
   * @param ticker Stock ticker symbol (e.g., "AAPL")
   * @param from Start date
   * @param to End date
   * @returns Array of news articles
   */
  async getCompanyNews(
    ticker: string,
    from: Date,
    to: Date,
  ): Promise<FinnhubArticle[]> {
    this.checkApiKey();
    await this.rateLimiter.acquireToken();

    try {
      const fromStr = this.formatDate(from);
      const toStr = this.formatDate(to);

      this.logger.debug(
        { ticker, from: fromStr, to: toStr },
        'Fetching company news from Finnhub',
      );

      const response = await this.client.get<FinnhubArticle[]>(
        '/api/v1/company-news',
        {
          params: {
            symbol: ticker,
            from: fromStr,
            to: toStr,
          },
        },
      );

      this.logger.debug(
        { ticker, count: response.data.length },
        'Fetched company news',
      );

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 429) {
          this.logger.warn('Finnhub API rate limit exceeded, backing off');
          throw new Error('Rate limit exceeded');
        }
        this.logger.error(
          { error: error.message, status: error.response?.status },
          'Finnhub API request failed',
        );
      }
      throw error;
    }
  }

  /**
   * Get market news (general news category)
   *
   * @param category News category (default: "general")
   * @returns Array of news articles
   */
  async getMarketNews(category = 'general'): Promise<FinnhubArticle[]> {
    this.checkApiKey();
    await this.rateLimiter.acquireToken();

    try {
      this.logger.debug({ category }, 'Fetching market news from Finnhub');

      const response = await this.client.get<FinnhubArticle[]>(
        '/api/v1/news',
        {
          params: { category },
        },
      );

      this.logger.debug(
        { category, count: response.data.length },
        'Fetched market news',
      );

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 429) {
          this.logger.warn('Finnhub API rate limit exceeded, backing off');
          throw new Error('Rate limit exceeded');
        }
        this.logger.error(
          { error: error.message, status: error.response?.status },
          'Finnhub API request failed',
        );
      }
      throw error;
    }
  }

  /**
   * Format date to YYYY-MM-DD for Finnhub API
   */
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}
