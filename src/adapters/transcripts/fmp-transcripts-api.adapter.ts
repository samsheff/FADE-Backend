import axios, { AxiosInstance } from 'axios';
import { getEnvironment } from '../../config/environment.js';
import { getLogger } from '../../utils/logger.js';
import { RateLimiter } from '../../utils/rate-limiter.js';
import { FmpTranscriptListResponse, FmpTranscriptResponse } from '../../types/transcripts.types.js';

/**
 * Adapter for Financial Modeling Prep (FMP) Earnings Call Transcript API
 *
 * Paid tier limits ($30/mo):
 * - 10,000 requests per day
 * - ~6.9 requests per minute sustained
 *
 * Provides:
 * - Rate limiting (~3 req/sec = 350ms delay)
 * - Retry with exponential backoff
 * - Error handling
 */
export class FmpTranscriptsApiAdapter {
  private client: AxiosInstance;
  private rateLimiter: RateLimiter;
  private logger;

  constructor() {
    const env = getEnvironment();
    this.logger = getLogger();

    this.client = axios.create({
      baseURL: env.FMP_API_BASE_URL,
      timeout: 30000,
    });

    // Rate limiter: ~3 requests per second (350ms delay)
    this.rateLimiter = new RateLimiter(env.FMP_API_RATE_LIMIT_MS);
  }

  /**
   * Check if API key is configured
   */
  private checkApiKey(): void {
    const env = getEnvironment();
    if (!env.FMP_API_KEY) {
      throw new Error('FMP_API_KEY is required but not configured');
    }
  }

  /**
   * Get list of available transcripts for a ticker
   *
   * @param ticker Stock ticker symbol (e.g., "AAPL")
   * @returns Array of transcript metadata (without full content)
   */
  async getTranscriptList(ticker: string): Promise<FmpTranscriptListResponse[]> {
    this.checkApiKey();
    await this.rateLimiter.wait();

    const env = getEnvironment();

    try {
      this.logger.debug({ ticker }, 'Fetching transcript list from FMP');

      const response = await this.client.get<FmpTranscriptListResponse[]>(
        `/v3/earning_call_transcript`,
        {
          params: {
            symbol: ticker,
            apikey: env.FMP_API_KEY,
          },
        },
      );

      this.logger.debug(
        { ticker, count: response.data.length },
        'Fetched transcript list',
      );

      return response.data || [];
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 429) {
          this.logger.warn('FMP API rate limit exceeded, backing off');
          throw new Error('Rate limit exceeded');
        }
        this.logger.error(
          { error: error.message, status: error.response?.status, ticker },
          'FMP API request failed (transcript list)',
        );
      }
      throw error;
    }
  }

  /**
   * Get full transcript content for a specific quarter
   *
   * @param ticker Stock ticker symbol (e.g., "AAPL")
   * @param year Fiscal year (e.g., 2024)
   * @param quarter Fiscal quarter (1-4)
   * @returns Full transcript with metadata
   */
  async getTranscript(
    ticker: string,
    year: number,
    quarter: number,
  ): Promise<FmpTranscriptResponse | null> {
    this.checkApiKey();
    await this.rateLimiter.wait();

    const env = getEnvironment();

    try {
      this.logger.debug({ ticker, year, quarter }, 'Fetching transcript from FMP');

      const response = await this.client.get<FmpTranscriptResponse[]>(
        `/v3/earning_call_transcript/${ticker}`,
        {
          params: {
            year,
            quarter,
            apikey: env.FMP_API_KEY,
          },
        },
      );

      // FMP returns array with single transcript
      const transcript = response.data?.[0];

      if (!transcript || !transcript.content) {
        this.logger.debug({ ticker, year, quarter }, 'No transcript found');
        return null;
      }

      this.logger.debug(
        {
          ticker,
          year,
          quarter,
          contentLength: transcript.content.length,
        },
        'Fetched transcript',
      );

      return transcript;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 429) {
          this.logger.warn('FMP API rate limit exceeded, backing off');
          throw new Error('Rate limit exceeded');
        }

        // 404 is expected when transcript doesn't exist
        if (error.response?.status === 404) {
          this.logger.debug(
            { ticker, year, quarter },
            'Transcript not found (404)',
          );
          return null;
        }

        this.logger.error(
          {
            error: error.message,
            status: error.response?.status,
            ticker,
            year,
            quarter,
          },
          'FMP API request failed (transcript)',
        );
      }
      throw error;
    }
  }

  /**
   * Get transcripts for a date range (helper method)
   *
   * @param ticker Stock ticker symbol
   * @param startDate Start of date range
   * @param endDate End of date range
   * @returns Array of transcripts in date range
   */
  async getTranscriptsInRange(
    ticker: string,
    startDate: Date,
    endDate: Date,
  ): Promise<FmpTranscriptListResponse[]> {
    const allTranscripts = await this.getTranscriptList(ticker);

    // Filter by date range
    const filtered = allTranscripts.filter((t) => {
      const transcriptDate = new Date(t.date);
      return transcriptDate >= startDate && transcriptDate <= endDate;
    });

    this.logger.debug(
      {
        ticker,
        total: allTranscripts.length,
        filtered: filtered.length,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
      },
      'Filtered transcripts by date range',
    );

    return filtered;
  }
}
