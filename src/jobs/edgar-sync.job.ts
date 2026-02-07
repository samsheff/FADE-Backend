import { EdgarIndexerService } from '../services/edgar/edgar-indexer.service.js';
import { FilingDownloaderService } from '../services/edgar/filing-downloader.service.js';
import { FilingParserService } from '../services/edgar/filing-parser.service.js';
import { FactExtractorService } from '../services/edgar/fact-extractor.service.js';
import { SignalComputerService } from '../services/edgar/signal-computer.service.js';
import { getEnvironment } from '../config/environment.js';
import { getLogger } from '../utils/logger.js';

/**
 * EDGAR Sync Job
 * Orchestrates the full pipeline: discover → download → parse → extract → compute signals
 */
export class EdgarSyncJob {
  private indexer: EdgarIndexerService;
  private downloader: FilingDownloaderService;
  private parser: FilingParserService;
  private factExtractor: FactExtractorService;
  private signalComputer: SignalComputerService;
  private logger;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor() {
    this.indexer = new EdgarIndexerService();
    this.downloader = new FilingDownloaderService();
    this.parser = new FilingParserService();
    this.factExtractor = new FactExtractorService();
    this.signalComputer = new SignalComputerService();
    this.logger = getLogger();
  }

  /**
   * Start the EDGAR sync job
   * Runs initial sync then schedules periodic runs
   */
  async start(): Promise<void> {
    const env = getEnvironment();
    this.logger.info(
      {
        interval: env.EDGAR_SYNC_INTERVAL_MS,
        batchSize: env.EDGAR_BATCH_SIZE,
        discoveryMode: env.EDGAR_DISCOVERY_MODE,
      },
      'Starting EDGAR sync job',
    );

    // Initial run
    await this.run();

    // Schedule periodic runs
    this.intervalId = setInterval(() => {
      this.run().catch((error) => {
        this.logger.error({ error }, 'EDGAR sync job error');
      });
    }, env.EDGAR_SYNC_INTERVAL_MS);

    this.logger.info('EDGAR sync job started');
  }

  /**
   * Stop the EDGAR sync job
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.info('EDGAR sync job stopped');
    }
  }

  /**
   * Run one iteration of the pipeline
   */
  private async run(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('EDGAR sync already running, skipping this iteration');
      return;
    }

    this.isRunning = true;
    const env = getEnvironment();
    const startTime = Date.now();

    try {
      this.logger.info('Starting EDGAR sync iteration');

      const stats = {
        newFilings: 0,
        downloaded: 0,
        parsed: 0,
        factsExtracted: 0,
        signals: 0,
      };

      // Stage 1: Discovery (if enabled)
      if (env.EDGAR_DISCOVERY_MODE) {
        stats.newFilings = await this.indexer.discoverNewFilings();
        this.logger.info({ count: stats.newFilings }, 'Discovery complete');
      }

      // Stage 2: Download pending filings
      stats.downloaded = await this.downloader.processPendingFilings(
        env.EDGAR_BATCH_SIZE,
      );
      this.logger.info({ count: stats.downloaded }, 'Download complete');

      // Stage 3: Parse downloaded filings
      stats.parsed = await this.parser.parseDownloadedFilings(
        env.EDGAR_BATCH_SIZE,
      );
      this.logger.info({ count: stats.parsed }, 'Parsing complete');

      // Stage 4: Extract facts from parsed filings
      stats.factsExtracted = await this.factExtractor.extractFactsFromParsedFilings(
        env.EDGAR_BATCH_SIZE,
      );
      this.logger.info({ count: stats.factsExtracted }, 'Fact extraction complete');

      // Stage 5: Compute signals from facts
      stats.signals = await this.signalComputer.computeSignals();
      this.logger.info({ count: stats.signals }, 'Signal computation complete');

      const duration = Date.now() - startTime;

      this.logger.info(
        {
          stats,
          durationMs: duration,
        },
        'EDGAR sync iteration complete',
      );
    } catch (error) {
      this.logger.error({ error }, 'EDGAR sync iteration failed');
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Run one iteration immediately (for manual trigger)
   */
  async runOnce(): Promise<void> {
    return this.run();
  }

  /**
   * Get job status
   */
  getStatus(): {
    running: boolean;
    hasScheduledRuns: boolean;
  } {
    return {
      running: this.isRunning,
      hasScheduledRuns: this.intervalId !== null,
    };
  }
}
