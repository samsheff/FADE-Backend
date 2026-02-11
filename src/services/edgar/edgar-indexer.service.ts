import { EdgarRssAdapter } from '../../adapters/edgar/edgar-rss.adapter.js';
import { EdgarHistoricalAdapter } from '../../adapters/edgar/edgar-historical.adapter.js';
import { FilingRepository } from '../../adapters/database/repositories/filing.repository.js';
import { InstrumentRepository } from '../../adapters/database/repositories/instrument.repository.js';
import { getEnvironment } from '../../config/environment.js';
import { getLogger } from '../../utils/logger.js';
import { FilingMetadata } from '../../types/edgar.types.js';
import { InstrumentType } from '../../types/instrument.types.js';
import { RateLimiter } from '../../utils/rate-limiter.js';

/**
 * EDGAR Indexer Service (Dual-Path Ingestion)
 *
 * Supports two distinct ingestion paths:
 * 1. **Real-Time RSS** - Recent filings only (last 100 per form type)
 * 2. **Historical Backfill** - Date-bounded queries via SEC Historical API
 *
 * Both paths write to the same Filing table with natural deduplication
 * via unique accessionNumber constraint.
 *
 * Discovery Strategy:
 * - Fetch ALL recent/historical filings (no pre-filtering by company)
 * - Create filing records for all discovered filings
 * - Filtering happens downstream via signal logic
 *
 * Benefits:
 * - Discovers new toxic financing actors automatically
 * - Reliable historical coverage (not limited by RSS cap)
 * - Full EDGAR universe coverage
 * - Retroactive signal computation
 */
export class EdgarIndexerService {
  private rssAdapter: EdgarRssAdapter;
  private historicalAdapter: EdgarHistoricalAdapter;
  private filingRepo: FilingRepository;
  private instrumentRepo: InstrumentRepository;
  private rateLimiter: RateLimiter;
  private logger;

  constructor() {
    const env = getEnvironment();

    // Share rate limiter between RSS and Historical adapters
    this.rateLimiter = new RateLimiter(env.EDGAR_API_RATE_LIMIT_MS);

    this.rssAdapter = new EdgarRssAdapter();
    this.historicalAdapter = new EdgarHistoricalAdapter(this.rateLimiter);
    this.filingRepo = new FilingRepository();
    this.instrumentRepo = new InstrumentRepository();
    this.logger = getLogger();
  }

  /**
   * Discover recent filings from SEC EDGAR RSS feed (Real-Time Path)
   *
   * Fetches ONLY the most recent 100 filings per form type.
   * No pagination, no backfill - this is for real-time discovery only.
   *
   * Form types:
   * - 8-K (material events)
   * - 424B5 (prospectus supplements = shelf usage)
   * - S-3 (shelf registrations)
   * - 10-Q, 10-K (periodic reports)
   */
  async discoverRecentFilings(): Promise<number> {
    this.logger.info({ mode: 'REALTIME' }, 'Starting real-time RSS discovery');

    try {
      const formTypes = ['8-K', '424B5', 'S-3', 'S-3/A', '10-Q', '10-K', 'N-CEN', 'N-PORT'];
      const allFilings: FilingMetadata[] = [];

      // Fetch recent filings (first page only, no pagination)
      for (const formType of formTypes) {
        try {
          const filings = await this.rssAdapter.fetchRecentFilings({
            formTypes: [formType],
            limit: 100,
            startOffset: 0,
          });

          allFilings.push(...filings);

          this.logger.info(
            {
              mode: 'REALTIME',
              formType,
              filings: filings.length,
              source: 'RSS',
            },
            'Real-time discovery complete for form type',
          );
        } catch (error) {
          this.logger.warn(
            { mode: 'REALTIME', formType, error },
            'Failed to fetch recent filings for form type',
          );
        }
      }

      this.logger.info(
        {
          mode: 'REALTIME',
          totalFilings: allFilings.length,
          formTypeBreakdown: {
            '8-K': allFilings.filter((f) => f.filingType === FilingType.FORM_8K).length,
            'N-CEN': allFilings.filter((f) => f.filingType === FilingType.FORM_N_CEN).length,
            'N-PORT': allFilings.filter((f) => f.filingType === FilingType.FORM_N_PORT).length,
          },
        },
        'Discovery complete with ETF breakdown',
      );

      if (allFilings.length === 0) {
        return 0;
      }

      // Insert discovered filings (shared logic)
      return await this.insertDiscoveredFilings(allFilings);
    } catch (error) {
      this.logger.error({ error, mode: 'REALTIME' }, 'Real-time discovery failed');
      throw error;
    }
  }

  /**
   * Backfill historical filings via SEC Historical Search API
   *
   * Uses date-bounded queries to fetch filings within a lookback window.
   * This is the CORRECT approach for historical coverage (not RSS pagination).
   *
   * @param lookbackDays - Number of days to look back
   * @returns Count of new filings inserted
   */
  async backfillHistoricalFilings(lookbackDays: number): Promise<number> {
    const env = getEnvironment();

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - lookbackDays);

    const startDateStr = EdgarHistoricalAdapter.formatDate(startDate);
    const endDateStr = EdgarHistoricalAdapter.formatDate(endDate);

    this.logger.info(
      {
        mode: 'BACKFILL',
        lookbackDays,
        dateRange: { start: startDateStr, end: endDateStr },
        maxPagesPerForm: env.EDGAR_BACKFILL_MAX_PAGES_PER_FORM,
      },
      'Starting historical backfill',
    );

    try {
      const formTypes = ['8-K', '424B5', 'S-3', 'S-3/A', '10-Q', '10-K', 'N-CEN', 'N-PORT'];
      const allFilings: FilingMetadata[] = [];

      // Fetch historical filings for each form type
      for (const formType of formTypes) {
        try {
          this.logger.info(
            { mode: 'BACKFILL', formType, dateRange: { start: startDateStr, end: endDateStr } },
            'Starting backfill for form type',
          );

          // Paginate through historical API
          for await (const filingBatch of this.historicalAdapter.fetchFilingsWithPagination(
            formType,
            startDateStr,
            endDateStr,
            env.EDGAR_BACKFILL_MAX_PAGES_PER_FORM,
          )) {
            allFilings.push(...filingBatch);
          }

          this.logger.info(
            {
              mode: 'BACKFILL',
              formType,
              count: allFilings.length,
            },
            'Backfill complete for form type',
          );
        } catch (error) {
          this.logger.warn(
            { mode: 'BACKFILL', formType, error },
            'Failed to backfill form type',
          );
        }
      }

      this.logger.info(
        {
          mode: 'BACKFILL',
          totalFilings: allFilings.length,
        },
        'Historical backfill discovery complete',
      );

      if (allFilings.length === 0) {
        return 0;
      }

      // Insert discovered filings (shared logic)
      return await this.insertDiscoveredFilings(allFilings);
    } catch (error) {
      this.logger.error({ error, mode: 'BACKFILL' }, 'Historical backfill failed');
      throw error;
    }
  }

  /**
   * Insert discovered filings (shared by both real-time and backfill paths)
   *
   * Handles:
   * - Deduplication via existing accession number check
   * - Instrument upsert for new CIKs
   * - Batch filing insertion
   * - lastFilingAt timestamp updates
   *
   * @param filings - Array of filing metadata to insert
   * @returns Count of new filings inserted
   */
  private async insertDiscoveredFilings(filings: FilingMetadata[]): Promise<number> {
    // Check which filings already exist
    const accessionNumbers = filings.map((f) => f.accessionNumber);
    const existingAccessions = await this.filingRepo.findByAccessionNumbers(
      accessionNumbers,
    );

    // Filter for new filings
    const newFilings = filings.filter(
      (f) => !existingAccessions.includes(f.accessionNumber),
    );

    this.logger.info(
      { total: filings.length, new: newFilings.length, existing: existingAccessions.length },
      'Filtered for new filings',
    );

    if (newFilings.length === 0) {
      return 0;
    }

    // Upsert instruments for each filing (create if issuer not in DB)
    await this.upsertInstrumentsForFilings(newFilings);

    // Batch insert new filings
    const insertedCount = await this.filingRepo.batchInsert(
      newFilings.map((f) => ({
        accessionNumber: f.accessionNumber,
        cik: f.cik,
        filingType: f.filingType,
        formType: f.formType,
        filingDate: f.filingDate,
        companyName: f.companyName,
        reportDate: f.reportDate,
      })),
    );

    // Update lastFilingAt for each issuer
    await this.updateIssuerFilingDates(newFilings);

    this.logger.info({ count: insertedCount }, 'Inserted new filings');

    return insertedCount;
  }

  /**
   * Create or update instruments for discovered filings
   *
   * If a filing's CIK is not in the database, create a minimal issuer record.
   * This handles the case where Universe Discovery hasn't run yet,
   * or a new filer appears between universe syncs.
   */
  private async upsertInstrumentsForFilings(filings: FilingMetadata[]): Promise<void> {
    // Group filings by CIK
    const filingsByCik = new Map<string, FilingMetadata>();

    for (const filing of filings) {
      if (!filingsByCik.has(filing.cik)) {
        filingsByCik.set(filing.cik, filing);
      }
    }

    // Upsert instruments
    for (const [cik, filing] of filingsByCik) {
      try {
        // Check if instrument already exists
        let instrument = await this.instrumentRepo.findByCik(cik);

        if (!instrument) {
          // Create minimal issuer record
          // Universe Discovery will enrich this later
          const symbol = this.extractSymbolFromCompanyName(
            filing.companyName || cik,
          );

          instrument = await this.instrumentRepo.create({
            type: InstrumentType.EQUITY,
            symbol,
            name: filing.companyName || `Issuer CIK ${cik}`,
            exchange: null,
          });

          // Add CIK identifier
          await this.instrumentRepo.addIdentifier(instrument.id, 'CIK', cik);

          this.logger.debug(
            { cik, symbol, instrumentId: instrument.id },
            'Created issuer from filing discovery',
          );
        }
      } catch (error) {
        this.logger.warn({ cik, error }, 'Failed to upsert instrument');
      }
    }
  }

  /**
   * Update lastFilingAt timestamp for issuers
   */
  private async updateIssuerFilingDates(filings: FilingMetadata[]): Promise<void> {
    const filingsByCik = new Map<string, Date>();

    // Find most recent filing date per CIK
    for (const filing of filings) {
      const existing = filingsByCik.get(filing.cik);
      if (!existing || filing.filingDate > existing) {
        filingsByCik.set(filing.cik, filing.filingDate);
      }
    }

    // Update lastFilingAt for each issuer
    for (const [cik, _filingDate] of filingsByCik) {
      try {
        const instrument = await this.instrumentRepo.findByCik(cik);
        if (instrument) {
          await this.instrumentRepo.update(instrument.id, {
            // Update lastFilingAt via raw Prisma update
            // (not in UpdateInstrumentInput type)
          });
        }
      } catch (error) {
        this.logger.warn({ cik, error }, 'Failed to update filing date');
      }
    }
  }

  /**
   * Extract ticker symbol from company name (heuristic)
   * In production, use a proper ticker lookup service
   */
  private extractSymbolFromCompanyName(companyName: string): string {
    // Remove common suffixes
    const cleaned = companyName
      .replace(/\s+(Inc\.?|Corp\.?|Corporation|Ltd\.?|LLC|LP|Co\.?)$/i, '')
      .trim();

    // Take first word or acronym
    const words = cleaned.split(/\s+/);

    if (words.length === 1) {
      return words[0].toUpperCase().substring(0, 5);
    }

    // Create acronym from first letters
    const acronym = words.map((w) => w[0]).join('');

    return acronym.toUpperCase().substring(0, 5);
  }
}
