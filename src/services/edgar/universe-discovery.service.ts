import * as crypto from 'crypto';
import { InstrumentRepository } from '../../adapters/database/repositories/instrument.repository.js';
import { getPrismaClient } from '../../adapters/database/client.js';
import { getLogger } from '../../utils/logger.js';
import { InstrumentType } from '../../types/instrument.types.js';
import { RateLimiter } from '../../utils/rate-limiter.js';
import { getEnvironment } from '../../config/environment.js';
import { SearchIndexerService } from '../search/search-indexer.service.js';

interface SecCompanyTicker {
  cik_str: number;
  ticker: string;
  title: string;
}

interface SecCompanyTickersResponse {
  [key: string]: SecCompanyTicker;
}

/**
 * EDGAR Universe Discovery Service
 *
 * Fetches the complete list of all SEC filers and populates the Instrument table.
 * This replaces hardcoded CIK watchlists with dynamic universe discovery.
 *
 * Data Source: https://www.sec.gov/files/company_tickers.json
 * Contains ~13,000 active SEC filers with CIK mappings.
 *
 * Architecture:
 * - Runs independently of filing ingestion
 * - Idempotent: safe to run multiple times
 * - Tracks new vs updated issuers
 * - Preserves issuer history (no deletions)
 */
export class EdgarUniverseDiscoveryService {
  private instrumentRepo: InstrumentRepository;
  private prisma;
  private logger;
  private rateLimiter: RateLimiter;
  private userAgent: string;
  private searchIndexer: SearchIndexerService | null = null;

  // SEC's authoritative source for all filers
  private static readonly COMPANY_TICKERS_URL =
    'https://www.sec.gov/files/company_tickers.json';

  constructor() {
    this.instrumentRepo = new InstrumentRepository();
    this.prisma = getPrismaClient();
    this.logger = getLogger();

    const env = getEnvironment();
    this.rateLimiter = new RateLimiter(env.EDGAR_API_RATE_LIMIT_MS);
    this.userAgent = env.EDGAR_API_USER_AGENT;

    // Initialize search indexer if enabled
    if (env.SEARCH_INDEXER_ENABLED) {
      this.searchIndexer = new SearchIndexerService();
    }
  }

  /**
   * Run full universe discovery
   *
   * Process:
   * 1. Fetch complete SEC filer list
   * 2. For each filer, upsert to Instrument table
   * 3. Track discovery metrics
   * 4. Record sync completion
   */
  async discoverUniverse(): Promise<{
    totalIssuers: number;
    newIssuers: number;
    updatedIssuers: number;
  }> {
    const syncStartedAt = new Date();
    let syncRecord;

    try {
      this.logger.info('Starting EDGAR universe discovery');

      // Create sync tracking record
      syncRecord = await this.prisma.edgarUniverseSync.create({
        data: {
          syncStartedAt,
          syncCompletedAt: syncStartedAt, // Will update on completion
          status: 'in_progress',
          sourceUrl: EdgarUniverseDiscoveryService.COMPANY_TICKERS_URL,
        },
      });

      // Fetch all SEC filers
      const filers = await this.fetchCompanyTickers();

      this.logger.info({ count: filers.length }, 'Fetched SEC company tickers');

      // Compute checksum for change detection
      const checksum = this.computeChecksum(filers);

      // Upsert all filers to database
      const { newCount, updatedCount } = await this.upsertFilers(filers);

      // Update sync record with results
      await this.prisma.edgarUniverseSync.update({
        where: { id: syncRecord.id },
        data: {
          syncCompletedAt: new Date(),
          status: 'completed',
          totalIssuers: filers.length,
          newIssuers: newCount,
          updatedIssuers: updatedCount,
          sourceChecksum: checksum,
        },
      });

      this.logger.info(
        {
          total: filers.length,
          new: newCount,
          updated: updatedCount,
        },
        'Universe discovery completed',
      );

      return {
        totalIssuers: filers.length,
        newIssuers: newCount,
        updatedIssuers: updatedCount,
      };
    } catch (error) {
      this.logger.error({ error }, 'Universe discovery failed');

      // Mark sync as failed
      if (syncRecord) {
        await this.prisma.edgarUniverseSync.update({
          where: { id: syncRecord.id },
          data: {
            syncCompletedAt: new Date(),
            status: 'failed',
            errorMessage: error instanceof Error ? error.message : String(error),
          },
        });
      }

      throw error;
    }
  }

  /**
   * Fetch complete list of SEC filers from company_tickers.json
   *
   * Response format:
   * {
   *   "0": { "cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc." },
   *   "1": { "cik_str": 789019, "ticker": "MSFT", "title": "MICROSOFT CORP" },
   *   ...
   * }
   */
  private async fetchCompanyTickers(): Promise<SecCompanyTicker[]> {
    await this.rateLimiter.wait();

    this.logger.debug('Fetching SEC company tickers');

    const response = await fetch(
      EdgarUniverseDiscoveryService.COMPANY_TICKERS_URL,
      {
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/json',
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `Failed to fetch company tickers: ${response.status} ${response.statusText}`,
      );
    }

    const data: SecCompanyTickersResponse = await response.json();

    // Convert object to array
    const filers = Object.values(data);

    return filers;
  }

  /**
   * Upsert filers to Instrument table
   *
   * Strategy:
   * - Use CIK as primary identifier
   * - Create Instrument + InstrumentIdentifier in transaction
   * - Set firstSeenAt on creation, update lastFilingAt when filings occur
   * - Never delete issuers, only mark inactive if needed
   */
  private async upsertFilers(
    filers: SecCompanyTicker[],
  ): Promise<{ newCount: number; updatedCount: number }> {
    let newCount = 0;
    let updatedCount = 0;

    this.logger.info({ count: filers.length }, 'Upserting filers to database');

    // Process in batches to avoid overwhelming the database
    const batchSize = 100;

    for (let i = 0; i < filers.length; i += batchSize) {
      const batch = filers.slice(i, i + batchSize);

      for (const filer of batch) {
        try {
          const cik = String(filer.cik_str).padStart(10, '0');
          const symbol = filer.ticker || this.generateSymbolFromName(filer.title);
          const name = filer.title;

          // Check if issuer already exists
          const existing = await this.instrumentRepo.findByCik(cik);

          if (existing) {
            // Update existing issuer (mark as active, update name if changed)
            if (existing.name !== name) {
              // Name changed - track as former name
              const formerNames = (existing.formerNames as string[]) || [];
              if (!formerNames.includes(existing.name)) {
                formerNames.push(existing.name);
              }

              await this.prisma.instrument.update({
                where: { id: existing.id },
                data: {
                  name,
                  formerNames,
                  isActive: true,
                  metadataSource: 'EDGAR',
                },
              });

              // Index instrument in search (don't block)
              if (this.searchIndexer) {
                this.searchIndexer.indexInstrument(existing.id).catch((error) => {
                  this.logger.warn({ error, instrumentId: existing.id }, 'Search indexing failed');
                });
              }

              updatedCount++;
            }
          } else {
            // Create new issuer
            const instrument = await this.instrumentRepo.create({
              type: InstrumentType.EQUITY,
              symbol,
              name,
              exchange: null, // Will be populated later if trading data available
            });

            // Add CIK identifier
            await this.instrumentRepo.addIdentifier(instrument.id, 'CIK', cik);

            // Set lifecycle metadata
            await this.prisma.instrument.update({
              where: { id: instrument.id },
              data: {
                firstSeenAt: new Date(),
                isActive: true,
                metadataSource: 'EDGAR',
              },
            });

            // Index instrument in search (don't block)
            if (this.searchIndexer) {
              this.searchIndexer.indexInstrument(instrument.id).catch((error) => {
                this.logger.warn({ error, instrumentId: instrument.id }, 'Search indexing failed');
              });
            }

            newCount++;
          }
        } catch (error) {
          this.logger.warn(
            { cik: filer.cik_str, error },
            'Failed to upsert filer',
          );
        }
      }

      this.logger.debug(
        { processed: i + batch.length, total: filers.length },
        'Batch progress',
      );
    }

    return { newCount, updatedCount };
  }

  /**
   * Generate a symbol from company name (heuristic)
   * Used when SEC data doesn't include ticker
   */
  private generateSymbolFromName(name: string): string {
    // Remove common suffixes
    const cleaned = name
      .replace(/\s+(Inc\.?|Corp\.?|Corporation|Ltd\.?|LLC|LP|Co\.?|Company)$/i, '')
      .trim();

    // Take first word or acronym
    const words = cleaned.split(/\s+/).filter((w) => w.length > 0);

    if (words.length === 1) {
      return words[0].toUpperCase().substring(0, 5);
    }

    // Create acronym from first letters
    const acronym = words.map((w) => w[0]).join('');
    return acronym.toUpperCase().substring(0, 5);
  }

  /**
   * Compute checksum of filer data for change detection
   */
  private computeChecksum(filers: SecCompanyTicker[]): string {
    const content = JSON.stringify(filers);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Get last successful sync
   */
  async getLastSync(): Promise<{
    syncCompletedAt: Date;
    totalIssuers: number;
    newIssuers: number;
  } | null> {
    const lastSync = await this.prisma.edgarUniverseSync.findFirst({
      where: { status: 'completed' },
      orderBy: { syncCompletedAt: 'desc' },
    });

    if (!lastSync) {
      return null;
    }

    return {
      syncCompletedAt: lastSync.syncCompletedAt,
      totalIssuers: lastSync.totalIssuers,
      newIssuers: lastSync.newIssuers,
    };
  }
}
