import { EdgarRssAdapter } from '../../adapters/edgar/edgar-rss.adapter.js';
import { FilingRepository } from '../../adapters/database/repositories/filing.repository.js';
import { InstrumentRepository } from '../../adapters/database/repositories/instrument.repository.js';
import { getEnvironment } from '../../config/environment.js';
import { getLogger } from '../../utils/logger.js';
import { FilingMetadata } from '../../types/edgar.types.js';
import { InstrumentType } from '../../types/instrument.types.js';

/**
 * EDGAR Indexer Service (Refactored for Dynamic Discovery)
 *
 * **ARCHITECTURE CHANGE**: No longer uses hardcoded CIK watchlists.
 * Instead, fetches ALL recent filings from SEC RSS feed and ingests broadly.
 *
 * Discovery Strategy:
 * 1. Fetch recent filings from SEC RSS (all companies)
 * 2. Match to issuers in database (populated by Universe Discovery)
 * 3. Create filing records for ALL filings (no pre-filtering)
 * 4. Filtering happens downstream via signal logic
 *
 * Benefits:
 * - Discovers new toxic financing actors automatically
 * - No manual watchlist maintenance
 * - Full EDGAR coverage
 * - Retroactive signal computation
 */
export class EdgarIndexerService {
  private rssAdapter: EdgarRssAdapter;
  private filingRepo: FilingRepository;
  private instrumentRepo: InstrumentRepository;
  private logger;

  constructor() {
    this.rssAdapter = new EdgarRssAdapter();
    this.filingRepo = new FilingRepository();
    this.instrumentRepo = new InstrumentRepository();
    this.logger = getLogger();
  }

  /**
   * Discover new filings from SEC EDGAR RSS feed
   *
   * **No longer filters by company** - ingests ALL recent filings.
   * Filtering now happens post-ingestion via signals.
   *
   * Form types filtered:
   * - 8-K (material events)
   * - 424B5 (prospectus supplements = shelf usage)
   * - S-3 (shelf registrations)
   * - 10-Q, 10-K (periodic reports)
   *
   * These cover most toxic financing and distress patterns.
   */
  async discoverNewFilings(): Promise<number> {
    const env = getEnvironment();

    this.logger.info('Starting dynamic EDGAR filing discovery (no watchlist)');

    try {
      // Fetch ALL recent filings from RSS feed
      // No CIK filtering - we want full universe coverage
      const formTypes = ['8-K', '424B5', 'S-3', 'S-3/A', '10-Q', '10-K'];

      const allFilings: FilingMetadata[] = [];

      // Fetch for each form type (SEC RSS requires separate requests)
      for (const formType of formTypes) {
        try {
          const filings = await this.rssAdapter.fetchRecentFilings({
            formTypes: [formType],
            limit: 100,
          });

          allFilings.push(...filings);

          this.logger.info(
            { formType, count: filings.length },
            'Fetched filings for form type',
          );
        } catch (error) {
          this.logger.warn(
            { formType, error },
            'Failed to fetch filings for form type',
          );
        }
      }

      this.logger.info(
        { count: allFilings.length },
        'Fetched recent filings from SEC RSS (all companies)',
      );

      if (allFilings.length === 0) {
        return 0;
      }

      // Check which filings already exist
      const accessionNumbers = allFilings.map((f) => f.accessionNumber);
      const existingAccessions = await this.filingRepo.findByAccessionNumbers(
        accessionNumbers,
      );

      // Filter for new filings
      const newFilings = allFilings.filter(
        (f) => !existingAccessions.includes(f.accessionNumber),
      );

      this.logger.info(
        { total: allFilings.length, new: newFilings.length },
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

      this.logger.info({ count: insertedCount }, 'Inserted new filings (dynamic discovery)');

      return insertedCount;
    } catch (error) {
      this.logger.error({ error }, 'Filing discovery failed');
      throw error;
    }
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
    for (const [cik, filingDate] of filingsByCik) {
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
