import { getEnvironment } from '../../config/environment.js';
import { RateLimiter } from '../../utils/rate-limiter.js';
import { FilingMetadata, FilingType } from '../../types/edgar.types.js';
import { getLogger } from '../../utils/logger.js';

interface SecSubmission {
  accessionNumber: string;
  filingDate: string;
  reportDate?: string;
  form: string;
}

interface SecCompanySubmissions {
  cik: string;
  name: string;
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      reportDate: string[];
      form: string[];
    };
  };
}

export class EdgarApiAdapter {
  private rateLimiter: RateLimiter;
  private userAgent: string;
  private logger;

  constructor() {
    const env = getEnvironment();
    this.rateLimiter = new RateLimiter(env.EDGAR_API_RATE_LIMIT_MS);
    this.userAgent = env.EDGAR_API_USER_AGENT;
    this.logger = getLogger();
  }

  /**
   * Discover recent filings matching specified criteria
   * Uses SEC EDGAR RSS feed or company submissions API
   */
  async discoverRecentFilings(options: {
    formTypes: string[];
    lookbackDays: number;
  }): Promise<FilingMetadata[]> {
    this.logger.info(
      { formTypes: options.formTypes, lookbackDays: options.lookbackDays },
      'Discovering recent EDGAR filings',
    );

    // For now, we'll use a basic approach: fetch recent filings from a seed list of CIKs
    // In production, you might use the RSS feed or bulk download index
    const seedCiks = await this.getSeedCiks();

    this.logger.info(
      { seedCiks, count: seedCiks.length },
      'Using seed CIKs for discovery',
    );

    const allFilings: FilingMetadata[] = [];
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - options.lookbackDays);

    for (const cik of seedCiks) {
      try {
        const filings = await this.getCompanyFilings(cik, {
          formTypes: options.formTypes,
          limit: 20,
        });

        this.logger.debug(
          { cik, totalFilings: filings.length },
          'Fetched filings for CIK',
        );

        // Filter by lookback window
        const recentFilings = filings.filter(
          (f) => f.filingDate >= cutoffDate,
        );

        this.logger.debug(
          { cik, recentCount: recentFilings.length, cutoffDate },
          'Filtered recent filings',
        );

        allFilings.push(...recentFilings);
      } catch (error) {
        this.logger.warn({ cik, error }, 'Failed to fetch company filings');
      }
    }

    this.logger.info({ count: allFilings.length }, 'Discovered filings');
    return allFilings;
  }

  /**
   * Get filings for a specific company by CIK
   * Uses SEC EDGAR company submissions API
   */
  async getCompanyFilings(
    cik: string,
    options: {
      limit?: number;
      formTypes?: string[];
    } = {},
  ): Promise<FilingMetadata[]> {
    await this.rateLimiter.wait();

    const paddedCik = cik.padStart(10, '0');
    const url = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;

    this.logger.debug({ cik, url }, 'Fetching company submissions');

    const response = await fetch(url, {
      headers: {
        'User-Agent': this.userAgent,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      this.logger.error(
        { cik, status: response.status, statusText: response.statusText },
        'SEC API request failed',
      );
      throw new Error(
        `SEC API error: ${response.status} ${response.statusText}`,
      );
    }

    const data: SecCompanySubmissions = await response.json();

    this.logger.debug(
      { cik, companyName: data.name, filingCount: data.filings.recent.accessionNumber.length },
      'Received SEC company data',
    );

    // Convert to FilingMetadata
    const filings: FilingMetadata[] = [];
    const recent = data.filings.recent;

    for (let i = 0; i < recent.accessionNumber.length; i++) {
      const formType = recent.form[i];

      // Filter by form types if specified
      if (options.formTypes && !options.formTypes.includes(formType)) {
        continue;
      }

      filings.push({
        accessionNumber: recent.accessionNumber[i],
        cik: data.cik,
        filingType: this.mapFormTypeToFilingType(formType),
        formType,
        filingDate: new Date(recent.filingDate[i]),
        companyName: data.name,
        reportDate: recent.reportDate[i]
          ? new Date(recent.reportDate[i])
          : undefined,
      });

      // Respect limit
      if (options.limit && filings.length >= options.limit) {
        break;
      }
    }

    return filings;
  }

  /**
   * Download raw filing document
   * Returns HTML/XBRL content as Buffer
   */
  async downloadFiling(
    accessionNumber: string,
    cik: string,
  ): Promise<Buffer> {
    await this.rateLimiter.wait();

    // Remove dashes from accession number for URL
    const accessionNumberNoDashes = accessionNumber.replace(/-/g, '');
    const paddedCik = cik.padStart(10, '0');

    // Construct filing URL
    const url = `https://www.sec.gov/Archives/edgar/data/${paddedCik}/${accessionNumberNoDashes}/${accessionNumber}.txt`;

    this.logger.debug({ accessionNumber, cik, url }, 'Downloading filing');

    const response = await this.fetchWithRetry(url, 3);

    if (!response.ok) {
      throw new Error(
        `Failed to download filing: ${response.status} ${response.statusText}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Fetch with exponential backoff retry logic
   */
  private async fetchWithRetry(
    url: string,
    maxRetries: number,
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': this.userAgent,
          },
        });

        return response;
      } catch (error) {
        lastError = error as Error;
        const backoffMs = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        this.logger.warn(
          { attempt, backoffMs, error },
          'Fetch failed, retrying',
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    throw lastError || new Error('Fetch failed after retries');
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
   * Get seed list of CIKs to monitor
   * In production, this would come from a database or config file
   * For now, returns a hardcoded list of known toxic financing candidates
   */
  private async getSeedCiks(): Promise<string[]> {
    // Example CIKs known for toxic financing patterns or frequent filings
    // These are real companies but this is just for demonstration
    return [
      '0001499961', // Mullen Automotive (known for aggressive dilution)
      '0001757932', // Aterian Inc
      '0001708176', // Nikola Corporation
      '0001826027', // Lordstown Motors
      '0001318605', // Tesla Inc (frequent filer - for testing)
      '0001018724', // Amazon (frequent filer - for testing)
      '0001652044', // Alphabet Inc (frequent filer - for testing)
      '0000789019', // Microsoft (frequent filer - for testing)
      // Add more CIKs as needed
    ];
  }
}
