import { getLogger } from '../../utils/logger.js';
import { RateLimiter } from '../../utils/rate-limiter.js';
import { getEnvironment } from '../../config/environment.js';
import { FilingMetadata, FilingType } from '../../types/edgar.types.js';

/**
 * EDGAR Historical Search API Adapter
 *
 * Uses the SEC EFTS Historical Search API for date-bounded filing queries.
 * This is the CORRECT tool for historical backfill (not RSS feeds).
 *
 * API: https://efts.sec.gov/LATEST/search-index
 * Returns Elasticsearch JSON with pagination support (100 results per page).
 *
 * Key differences from RSS:
 * - Supports date range queries (startdt, enddt)
 * - Reliable pagination via offset
 * - No 200-filing cap
 * - Ideal for backfill, not real-time
 */
export class EdgarHistoricalAdapter {
  private logger;
  private rateLimiter: RateLimiter;
  private userAgent: string;

  // SEC Historical Search API endpoint
  private static readonly HISTORICAL_API_URL = 'https://efts.sec.gov/LATEST/search-index';

  constructor(rateLimiter?: RateLimiter) {
    this.logger = getLogger();

    const env = getEnvironment();
    // Share rate limiter with RSS adapter if provided
    this.rateLimiter = rateLimiter || new RateLimiter(env.EDGAR_API_RATE_LIMIT_MS);
    this.userAgent = env.EDGAR_API_USER_AGENT;
  }

  /**
   * Fetch filings by date range (single page)
   *
   * @param formType - Form type (e.g., '8-K', '424B5')
   * @param startDate - Start date (YYYY-MM-DD)
   * @param endDate - End date (YYYY-MM-DD)
   * @param options - Pagination options
   * @returns Filing metadata array and total count
   */
  async fetchFilingsByDateRange(
    formType: string,
    startDate: string,
    endDate: string,
    options?: { offset?: number; limit?: number }
  ): Promise<{ filings: FilingMetadata[]; total: number }> {
    await this.rateLimiter.wait();

    const offset = options?.offset || 0;
    const limit = options?.limit || 100;

    // Build query parameters
    const params = new URLSearchParams({
      category: 'custom',
      forms: formType,
      startdt: startDate,
      enddt: endDate,
      from: offset.toString(),
      size: limit.toString(),
    });

    const url = `${EdgarHistoricalAdapter.HISTORICAL_API_URL}?${params}`;

    this.logger.debug(
      {
        formType,
        dateRange: { start: startDate, end: endDate },
        offset,
        limit,
      },
      'Fetching historical filings',
    );

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        // Handle rate limiting
        if (response.status === 429) {
          this.logger.warn('SEC API rate limit hit, implementing backoff');
          throw new Error('RATE_LIMIT');
        }

        // Handle service unavailable
        if (response.status === 503) {
          this.logger.warn('SEC API service unavailable');
          throw new Error('SERVICE_UNAVAILABLE');
        }

        throw new Error(
          `SEC Historical API error: ${response.status} ${response.statusText}`,
        );
      }

      const jsonData = await response.json();

      this.logger.debug(
        {
          formType,
          offset,
          hitsInPage: jsonData.hits?.hits?.length || 0,
          total: jsonData.hits?.total?.value || 0,
        },
        'Fetched historical API page',
      );

      const filings = this.parseHistoricalResponse(jsonData);
      const total = jsonData.hits?.total?.value || 0;

      return { filings, total };
    } catch (error) {
      this.logger.error({ error, formType, offset }, 'Failed to fetch historical filings');
      throw error;
    }
  }

  /**
   * Fetch filings with automatic pagination (async generator)
   *
   * Yields batches of filings until:
   * - All filings fetched
   * - Max pages reached
   * - Oldest filing date < cutoff
   *
   * @param formType - Form type (e.g., '8-K')
   * @param startDate - Start date (YYYY-MM-DD)
   * @param endDate - End date (YYYY-MM-DD)
   * @param maxPages - Maximum pages to fetch (safety limit)
   */
  async *fetchFilingsWithPagination(
    formType: string,
    startDate: string,
    endDate: string,
    maxPages = 50,
  ): AsyncGenerator<FilingMetadata[], void, unknown> {
    let currentPage = 0;
    let totalFetched = 0;
    const progressInterval = setInterval(() => {
      this.logger.info(
        {
          mode: 'BACKFILL',
          formType,
          dateRange: { start: startDate, end: endDate },
          page: currentPage,
          totalPages: maxPages,
          filingsDiscovered: totalFetched,
        },
        'Backfill progress',
      );
    }, 30000); // Log every 30 seconds

    try {
      while (currentPage < maxPages) {
        const offset = currentPage * 100;

        let pageResult;
        let retryCount = 0;
        const maxRetries = 3;

        // Retry logic with exponential backoff
        while (retryCount < maxRetries) {
          try {
            pageResult = await this.fetchFilingsByDateRange(
              formType,
              startDate,
              endDate,
              { offset, limit: 100 },
            );
            break; // Success, exit retry loop
          } catch (error) {
            if (error instanceof Error) {
              if (error.message === 'RATE_LIMIT') {
                // Exponential backoff: 1s, 2s, 4s, 8s
                const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 8000);
                this.logger.warn(
                  { retryCount, backoffMs },
                  'Rate limited, backing off',
                );
                await new Promise((resolve) => setTimeout(resolve, backoffMs));
                retryCount++;
                continue;
              }

              if (error.message === 'SERVICE_UNAVAILABLE') {
                // Wait 60s for service recovery
                this.logger.warn('Service unavailable, waiting 60s');
                await new Promise((resolve) => setTimeout(resolve, 60000));
                retryCount++;
                continue;
              }
            }

            // Other errors - log and skip this page
            this.logger.error(
              { error, formType, page: currentPage },
              'Failed to fetch page, skipping',
            );
            break;
          }
        }

        // If we exhausted retries, continue to next page
        if (!pageResult) {
          currentPage++;
          continue;
        }

        const { filings, total } = pageResult;

        // No more results
        if (filings.length === 0) {
          this.logger.info(
            { formType, page: currentPage, totalFetched },
            'No more results, backfill complete',
          );
          break;
        }

        totalFetched += filings.length;

        // Yield this batch
        yield filings;

        // Check if we've fetched all available filings
        if (totalFetched >= total) {
          this.logger.info(
            { formType, totalFetched, total },
            'Fetched all available filings',
          );
          break;
        }

        currentPage++;
      }

      if (currentPage >= maxPages) {
        this.logger.warn(
          { formType, maxPages, totalFetched },
          'Max pages reached, backfill may be incomplete',
        );
      }
    } finally {
      clearInterval(progressInterval);
    }
  }

  /**
   * Parse SEC Historical API response
   *
   * Response format (Elasticsearch):
   * {
   *   "hits": {
   *     "total": { "value": 1234 },
   *     "hits": [
   *       {
   *         "_id": "...",
   *         "_source": {
   *           "adsh": "0001318605-26-000010",
   *           "ciks": ["0001318605"],
   *           "form": "8-K",
   *           "file_date": "2026-02-06",
   *           "period_ending": "2026-02-01",
   *           "display_names": ["TESLA INC"]
   *         }
   *       }
   *     ]
   *   }
   * }
   */
  private parseHistoricalResponse(jsonData: any): FilingMetadata[] {
    const filings: FilingMetadata[] = [];

    if (!jsonData.hits?.hits) {
      this.logger.warn('Invalid response format - missing hits.hits');
      return filings;
    }

    for (const hit of jsonData.hits.hits) {
      try {
        const source = hit._source;

        // Extract required fields
        const accessionNumber = source.adsh;
        const cik = source.ciks?.[0]?.padStart(10, '0');
        const formType = source.form;
        const filingDate = source.file_date
          ? new Date(source.file_date)
          : new Date();
        const companyName = source.display_names?.[0];
        const reportDate = source.period_ending
          ? new Date(source.period_ending)
          : undefined;

        if (!accessionNumber || !cik || !formType) {
          this.logger.debug(
            { accessionNumber, cik, formType },
            'Skipped historical entry - missing required fields',
          );
          continue;
        }

        filings.push({
          accessionNumber,
          cik,
          filingType: this.mapFormTypeToFilingType(formType),
          formType,
          filingDate,
          companyName,
          reportDate,
        });
      } catch (error) {
        this.logger.warn({ error, hit }, 'Failed to parse historical entry');
      }
    }

    return filings;
  }

  /**
   * Map SEC form type to our FilingType enum
   */
  private mapFormTypeToFilingType(formType: string): FilingType {
    const normalized = formType.toUpperCase().replace(/\s+/g, '');

    if (normalized === '8-K' || normalized.startsWith('8-K/')) {
      return FilingType.FORM_8K;
    }
    if (normalized === '10-Q' || normalized.startsWith('10-Q/')) {
      return FilingType.FORM_10Q;
    }
    if (normalized === '10-K' || normalized.startsWith('10-K/')) {
      return FilingType.FORM_10K;
    }
    if (normalized === '424B5') {
      return FilingType.FORM_424B5;
    }
    if (normalized === 'S-3' || normalized.startsWith('S-3/')) {
      return FilingType.FORM_S3;
    }
    if (normalized.includes('ATM') || normalized.includes('EQUITY DISTRIBUTION')) {
      return FilingType.ATM_FILING;
    }
    if (normalized === 'DEF14A') {
      return FilingType.PROXY_DEF14A;
    }
    if (normalized === 'N-CEN' || normalized.startsWith('N-CEN/')) {
      return FilingType.FORM_N_CEN;
    }
    if (normalized === 'N-PORT' || normalized.startsWith('N-PORT/')) {
      return FilingType.FORM_N_PORT;
    }

    return FilingType.OTHER;
  }

  /**
   * Format date for SEC API (YYYY-MM-DD)
   */
  static formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}
