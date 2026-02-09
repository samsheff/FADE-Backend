import { getLogger } from '../../utils/logger.js';
import { RateLimiter } from '../../utils/rate-limiter.js';
import { getEnvironment } from '../../config/environment.js';
import { FilingMetadata, FilingType } from '../../types/edgar.types.js';

/**
 * EDGAR RSS Feed Adapter
 *
 * Fetches recent filings from SEC EDGAR's RSS feeds.
 * This replaces the hardcoded CIK approach with dynamic discovery.
 *
 * RSS Feed: https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent
 * Returns most recent filings across ALL SEC filers.
 *
 * Architecture:
 * - No watchlist required
 * - Fetches filings for entire SEC universe
 * - Filtering happens downstream (signals, not ingestion)
 */
export class EdgarRssAdapter {
  private logger;
  private rateLimiter: RateLimiter;
  private userAgent: string;

  // SEC RSS feed endpoint (returns XML)
  private static readonly RSS_FEED_URL =
    'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=&company=&dateb=&owner=include&start=0&count=100&output=atom';

  constructor() {
    this.logger = getLogger();

    const env = getEnvironment();
    this.rateLimiter = new RateLimiter(env.EDGAR_API_RATE_LIMIT_MS);
    this.userAgent = env.EDGAR_API_USER_AGENT;
  }

  /**
   * Fetch recent filings from SEC RSS feed
   *
   * Returns up to 100 most recent filings across entire SEC universe.
   * No company filtering - we ingest broadly and filter later.
   *
   * @param formTypes - Optional filter by form type (e.g., ['8-K', '424B5'])
   * @param startOffset - Pagination offset (default: 0)
   * @returns Array of filing metadata
   */
  async fetchRecentFilings(options?: {
    formTypes?: string[];
    limit?: number;
    startOffset?: number;
  }): Promise<FilingMetadata[]> {
    await this.rateLimiter.wait();

    this.logger.debug('Fetching SEC RSS feed for recent filings');

    try {
      // Build RSS URL with form type filter if specified
      let url = EdgarRssAdapter.RSS_FEED_URL;

      if (options?.formTypes && options.formTypes.length > 0) {
        // SEC RSS accepts single form type per request
        // For multiple types, we'd need to make multiple requests
        const formType = options.formTypes[0];
        const startOffset = options.startOffset || 0;
        url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${formType}&company=&dateb=&owner=include&start=${startOffset}&count=${options.limit || 100}&output=atom`;
      }

      const response = await fetch(url, {
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/atom+xml',
        },
      });

      if (!response.ok) {
        throw new Error(
          `SEC RSS feed error: ${response.status} ${response.statusText}`,
        );
      }

      const xmlText = await response.text();

      this.logger.info(
        {
          url: url.substring(0, 100),
          xmlLength: xmlText.length,
          formType: options?.formTypes?.[0] || 'all'
        },
        'Fetched RSS feed XML',
      );

      // Parse RSS/Atom feed XML
      const filings = this.parseRssFeed(xmlText);

      this.logger.info(
        { count: filings.length, formType: options?.formTypes?.[0] || 'all' },
        'Parsed filings from RSS XML',
      );

      // Filter by form types if specified
      if (options?.formTypes && options.formTypes.length > 1) {
        return filings.filter((f) => options.formTypes!.includes(f.formType));
      }

      return filings;
    } catch (error) {
      this.logger.error({ error }, 'Failed to fetch SEC RSS feed');
      throw error;
    }
  }


  /**
   * Parse SEC EDGAR Atom/RSS XML feed
   *
   * Example entry:
   * <entry>
   *   <title>8-K - TESLA INC (0001318605)</title>
   *   <link href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001318605&type=8-K&dateb=&owner=exclude&count=100"/>
   *   <summary>...</summary>
   *   <updated>2026-02-06T12:34:56-05:00</updated>
   *   <category term="form" label="8-K"/>
   *   <category term="cik" label="0001318605"/>
   *   <category term="accession-number" label="0001318605-26-000010"/>
   * </entry>
   */
  private parseRssFeed(xmlText: string): FilingMetadata[] {
    const filings: FilingMetadata[] = [];

    // Simple regex-based XML parsing (for production, use a proper XML library)
    const entryPattern = /<entry>([\s\S]*?)<\/entry>/g;
    let entryMatch;
    let entryCount = 0;

    while ((entryMatch = entryPattern.exec(xmlText)) !== null) {
      const entry = entryMatch[1];

      try {
        // Extract title: "10-K - AMAZON COM INC (0001018724) (Filer)"
        const titleMatch = entry.match(/<title>(.*?)<\/title>/);
        const title = titleMatch ? titleMatch[1] : '';

        // Extract CIK from title (number in parentheses)
        const cikMatch = title.match(/\((\d+)\)/);
        const cik = cikMatch ? cikMatch[1].padStart(10, '0') : null;

        // Extract accession number from <id> tag
        // Format: urn:tag:sec.gov,2008:accession-number=0001018724-26-000004
        const idMatch = entry.match(/<id>urn:tag:sec\.gov,\d+:accession-number=([^<]+)<\/id>/);
        const accessionNumber = idMatch ? idMatch[1] : null;

        // Extract form type from category
        const formMatch = entry.match(/<category[^>]+label="form type" term="([^"]+)"\s*\/>/);
        const formType = formMatch ? formMatch[1] : '';

        // Extract filing date
        const dateMatch = entry.match(/<updated>(.*?)<\/updated>/);
        const filingDate = dateMatch ? new Date(dateMatch[1]) : new Date();

        // Extract company name from title (text between dash and first parenthesis)
        const nameMatch = title.match(/- (.+?) \(/);
        const companyName = nameMatch ? nameMatch[1].trim() : undefined;

        if (cik && accessionNumber && formType) {
          filings.push({
            accessionNumber,
            cik,
            filingType: this.mapFormTypeToFilingType(formType),
            formType,
            filingDate,
            companyName,
          });
        } else {
          this.logger.debug(
            { cik, accessionNumber, formType, title },
            'Skipped RSS entry - missing required fields',
          );
        }
      } catch (error) {
        this.logger.warn({ error, entry }, 'Failed to parse RSS entry');
      }
    }

    this.logger.info(
      { entriesFound: entryCount, filingsParsed: filings.length },
      'RSS XML parsing complete',
    );

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

    return FilingType.OTHER;
  }
}
