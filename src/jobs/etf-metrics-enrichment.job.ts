import { getLogger } from '../utils/logger.js';
import { getEnvironment } from '../config/environment.js';
import type { Logger } from 'pino';
import { FilingRepository } from '../adapters/database/repositories/filing.repository.js';
import { InstrumentRepository } from '../adapters/database/repositories/instrument.repository.js';
import { EtfMetricsExtractionService } from '../services/etf/etf-metrics-extraction.service.js';
import { EtfMetricsRepository } from '../adapters/database/repositories/etf-metrics.repository.js';
import { EtfApDetailRepository } from '../adapters/database/repositories/etf-ap-detail.repository.js';
import { FilingStatus, FilingType } from '../types/edgar.types.js';
import { getPrismaClient } from '../adapters/database/client.js';

interface EtfEnrichmentStats {
  totalFilings: number;
  metricsExtracted: number;
  apDetailsExtracted: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
}

/**
 * Background job for enriching ETF instruments with metrics from N-CEN and N-PORT filings
 */
export class EtfMetricsEnrichmentJob {
  private logger: Logger;
  private filingRepo: FilingRepository;
  private instrumentRepo: InstrumentRepository;
  private extractionService: EtfMetricsExtractionService;
  private etfMetricsRepo: EtfMetricsRepository;
  private etfApRepo: EtfApDetailRepository;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor() {
    this.logger = getLogger().child({ job: 'EtfMetricsEnrichmentJob' });
    const prisma = getPrismaClient();
    this.filingRepo = new FilingRepository();
    this.instrumentRepo = new InstrumentRepository();
    this.extractionService = new EtfMetricsExtractionService(prisma);
    this.etfMetricsRepo = new EtfMetricsRepository(prisma);
    this.etfApRepo = new EtfApDetailRepository(prisma);
  }

  /**
   * Start the job with scheduled runs
   */
  async start(): Promise<void> {
    const env = getEnvironment();

    if (!env.ETF_METRICS_ENRICHMENT_ENABLED) {
      this.logger.info('ETF metrics enrichment job is disabled');
      return;
    }

    this.logger.info('Starting ETF metrics enrichment job');

    // Initial run
    await this.run();

    // Schedule daily runs
    this.intervalId = setInterval(() => {
      this.run().catch((error) => {
        this.logger.error({ err: error }, 'Scheduled ETF metrics enrichment run failed');
      });
    }, env.ETF_METRICS_ENRICHMENT_INTERVAL_MS);

    this.logger.info(
      { intervalMs: env.ETF_METRICS_ENRICHMENT_INTERVAL_MS },
      'ETF metrics enrichment job scheduled'
    );
  }

  /**
   * Stop the job and clear scheduled runs
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.info('ETF metrics enrichment job stopped');
    }
  }

  /**
   * Run enrichment for parsed N-CEN and N-PORT filings
   */
  async run(): Promise<EtfEnrichmentStats> {
    if (this.isRunning) {
      this.logger.warn('ETF metrics enrichment job already running, skipping');
      return {
        totalFilings: 0,
        metricsExtracted: 0,
        apDetailsExtracted: 0,
        errors: 0,
        startTime: new Date(),
      };
    }

    this.isRunning = true;

    const stats: EtfEnrichmentStats = {
      totalFilings: 0,
      metricsExtracted: 0,
      apDetailsExtracted: 0,
      errors: 0,
      startTime: new Date(),
    };

    try {
      const env = getEnvironment();
      const batchSize = env.ETF_METRICS_BATCH_SIZE;

      this.logger.info('Starting ETF metrics enrichment');

      // Get PARSED filings that are N-CEN or N-PORT
      const parsedFilings = await this.filingRepo.findByStatus(
        FilingStatus.PARSED,
        batchSize
      );

      const etfFilings = parsedFilings.filter(
        (f) => f.filingType === FilingType.FORM_N_CEN || f.filingType === FilingType.FORM_N_PORT
      );

      stats.totalFilings = etfFilings.length;

      this.logger.info(
        { totalFilings: stats.totalFilings },
        'Found parsed ETF filings to enrich'
      );

      if (etfFilings.length === 0) {
        this.logger.debug('No ETF filings to process');
        return stats;
      }

      // Process each filing
      for (const filing of etfFilings) {
        try {
          await this.processFiling(filing, stats);

          // Mark filing as enriched
          await this.filingRepo.updateStatus(filing.id, FilingStatus.ENRICHED);
        } catch (error) {
          this.logger.error(
            { filingId: filing.id, cik: filing.cik, error },
            'Failed to enrich filing'
          );
          stats.errors++;
        }
      }

      stats.endTime = new Date();

      this.logger.info({ stats }, 'ETF metrics enrichment complete');

      return stats;
    } catch (error) {
      this.logger.error({ err: error }, 'ETF metrics enrichment run failed');
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Process a single filing
   */
  private async processFiling(
    filing: any,
    stats: EtfEnrichmentStats
  ): Promise<void> {
    // Find instrument by CIK
    const instrument = await this.instrumentRepo.findByCik(filing.cik);
    if (!instrument) {
      this.logger.warn(
        { cik: filing.cik, filingId: filing.id },
        'No instrument found for CIK'
      );
      return;
    }

    // Only process ETF instruments
    if (instrument.type !== 'ETF') {
      this.logger.debug(
        { instrumentId: instrument.id, type: instrument.type },
        'Skipping non-ETF instrument'
      );
      return;
    }

    this.logger.info(
      {
        instrumentId: instrument.id,
        symbol: instrument.symbol,
        filingType: filing.filingType,
        filingDate: filing.filingDate,
      },
      'Processing ETF filing'
    );

    // Extract metrics based on filing type
    if (filing.filingType === FilingType.FORM_N_CEN) {
      await this.processNCEN(filing, instrument.id, stats);
    } else if (filing.filingType === FilingType.FORM_N_PORT) {
      await this.processNPORT(filing, instrument.id, stats);
    }
  }

  /**
   * Process N-CEN filing
   */
  private async processNCEN(
    filing: any,
    instrumentId: string,
    stats: EtfEnrichmentStats
  ): Promise<void> {
    // Extract metrics
    const metrics = await this.extractionService.extractMetricsFromNCEN(
      filing,
      instrumentId
    );

    if (metrics) {
      await this.etfMetricsRepo.upsertMetrics(metrics);
      stats.metricsExtracted++;
      this.logger.debug({ instrumentId, filingId: filing.id }, 'Extracted N-CEN metrics');
    }

    // Extract AP list
    const apList = await this.extractionService.extractApListFromNCEN(
      filing,
      instrumentId
    );

    if (apList.length > 0) {
      const count = await this.etfApRepo.bulkUpsertApDetails(apList);
      stats.apDetailsExtracted += count;
      this.logger.debug(
        { instrumentId, filingId: filing.id, apCount: count },
        'Extracted AP details'
      );

      // Calculate and update HHI if we have AP shares
      const apShares = apList
        .filter((ap) => ap.shareOfActivity !== null)
        .map((ap) => Number(ap.shareOfActivity));

      if (apShares.length > 0) {
        const hhi = this.extractionService.calculateHHI(apShares);
        const topThreeApShare = this.calculateTopThreeShare(apShares);

        // Update metrics with HHI and top-3 share
        if (metrics) {
          metrics.hhi = hhi;
          metrics.topThreeApShare = topThreeApShare;
          await this.etfMetricsRepo.upsertMetrics(metrics);
        }
      }
    }
  }

  /**
   * Process N-PORT filing
   */
  private async processNPORT(
    filing: any,
    instrumentId: string,
    stats: EtfEnrichmentStats
  ): Promise<void> {
    const metrics = await this.extractionService.extractMetricsFromNPORT(
      filing,
      instrumentId
    );

    if (metrics) {
      await this.etfMetricsRepo.upsertMetrics(metrics);
      stats.metricsExtracted++;
      this.logger.debug({ instrumentId, filingId: filing.id }, 'Extracted N-PORT metrics');
    }
  }

  /**
   * Calculate top-3 AP share from AP shares
   */
  private calculateTopThreeShare(apShares: number[]): any {
    if (apShares.length === 0) return null;

    const sortedShares = [...apShares].sort((a, b) => b - a);
    const topThree = sortedShares.slice(0, 3);
    const total = apShares.reduce((sum, share) => sum + share, 0);

    if (total === 0) return null;

    const topThreeSum = topThree.reduce((sum, share) => sum + share, 0);
    return ((topThreeSum / total) * 100).toFixed(2);
  }
}
