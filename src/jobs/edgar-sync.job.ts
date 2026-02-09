import { EdgarIndexerService } from '../services/edgar/edgar-indexer.service.js';
import { FilingDownloaderService } from '../services/edgar/filing-downloader.service.js';
import { FilingParserService } from '../services/edgar/filing-parser.service.js';
import { FactExtractorService } from '../services/edgar/fact-extractor.service.js';
import { SignalComputerService } from '../services/edgar/signal-computer.service.js';
import { getEnvironment } from '../config/environment.js';
import { getLogger } from '../utils/logger.js';

/**
 * EDGAR Sync Job (Dual-Path Orchestration)
 *
 * Orchestrates two ingestion paths:
 * 1. Historical Backfill (runs once on startup) → SEC Historical API
 * 2. Real-Time Discovery (periodic polling) → RSS feeds
 *
 * Both paths feed into the same pipeline:
 * discover → download → parse → extract → compute signals
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
  private hasRunBackfill = false; // In-memory flag for one-time backfill

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
   *
   * Runs historical backfill ONCE on first startup,
   * then continues with periodic real-time RSS polling.
   */
  async start(): Promise<void> {
    const env = getEnvironment();
    this.logger.info(
      {
        interval: env.EDGAR_SYNC_INTERVAL_MS,
        batchSize: env.EDGAR_BATCH_SIZE,
        discoveryMode: env.EDGAR_DISCOVERY_MODE,
        backfillEnabled: env.EDGAR_BACKFILL_ENABLED,
        backfillLookbackDays: env.EDGAR_BACKFILL_LOOKBACK_DAYS,
      },
      'Starting EDGAR sync job',
    );

    // Run backfill ONCE on first startup
    if (env.EDGAR_BACKFILL_ENABLED && !this.hasRunBackfill) {
      this.logger.info('Starting EDGAR historical backfill...');
      await this.runBackfill();
      this.hasRunBackfill = true;
      this.logger.info('EDGAR historical backfill complete');
    }

    // Initial real-time run
    await this.run();

    // Schedule periodic real-time runs
    this.intervalId = setInterval(() => {
      this.run().catch((error) => {
        this.logger.error({ error }, 'EDGAR sync job error');
      });
    }, env.EDGAR_SYNC_INTERVAL_MS);

    this.logger.info('EDGAR sync job started (real-time polling)');
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
   * Run historical backfill (one-time on startup)
   *
   * Stage 1: Historical discovery via SEC API
   * Stages 2-5: Process backfilled filings (download/parse/extract/compute)
   */
  private async runBackfill(): Promise<void> {
    const env = getEnvironment();
    const startTime = Date.now();

    try {
      this.logger.info({ mode: 'BACKFILL' }, 'Starting historical backfill iteration');

      const stats = {
        newFilings: 0,
        downloaded: 0,
        parsed: 0,
        factsExtracted: 0,
        signals: 0,
      };

      // Stage 1: Historical backfill discovery
      const discoveryStart = Date.now();
      stats.newFilings = await this.indexer.backfillHistoricalFilings(
        env.EDGAR_BACKFILL_LOOKBACK_DAYS,
      );
      const discoveryDuration = Date.now() - discoveryStart;

      this.logger.info(
        {
          mode: 'BACKFILL',
          count: stats.newFilings,
          durationMs: discoveryDuration,
          lookbackDays: env.EDGAR_BACKFILL_LOOKBACK_DAYS,
        },
        'Historical discovery complete',
      );

      // Stages 2-5: Process backfilled filings
      stats.downloaded = await this.downloader.processPendingFilings(
        env.EDGAR_BATCH_SIZE,
      );
      this.logger.info({ mode: 'BACKFILL', count: stats.downloaded }, 'Download complete');

      stats.parsed = await this.parser.parseDownloadedFilings(
        env.EDGAR_BATCH_SIZE,
      );
      this.logger.info({ mode: 'BACKFILL', count: stats.parsed }, 'Parsing complete');

      stats.factsExtracted = await this.factExtractor.extractFactsFromParsedFilings(
        env.EDGAR_BATCH_SIZE,
      );
      this.logger.info({ mode: 'BACKFILL', count: stats.factsExtracted }, 'Fact extraction complete');

      stats.signals = await this.signalComputer.computeSignals();
      this.logger.info({ mode: 'BACKFILL', count: stats.signals }, 'Signal computation complete');

      const duration = Date.now() - startTime;

      this.logger.info(
        {
          mode: 'BACKFILL',
          stats,
          durationMs: duration,
        },
        'Historical backfill iteration complete',
      );
    } catch (error) {
      this.logger.error({ error, mode: 'BACKFILL' }, 'Historical backfill iteration failed');
      throw error;
    }
  }

  /**
   * Run one iteration of real-time pipeline
   *
   * Stage 1: Real-time RSS discovery
   * Stages 2-5: Process new filings (download/parse/extract/compute)
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
      this.logger.info({ mode: 'REALTIME' }, 'Starting real-time sync iteration');

      const stats = {
        newFilings: 0,
        downloaded: 0,
        parsed: 0,
        factsExtracted: 0,
        signals: 0,
      };

      // Stage 1: Real-time RSS discovery (if enabled)
      if (env.EDGAR_DISCOVERY_MODE) {
        const discoveryStart = Date.now();
        stats.newFilings = await this.indexer.discoverRecentFilings();
        const discoveryDuration = Date.now() - discoveryStart;

        this.logger.info(
          {
            mode: 'REALTIME',
            count: stats.newFilings,
            durationMs: discoveryDuration,
            filingsPerSec: stats.newFilings > 0
              ? ((stats.newFilings / discoveryDuration) * 1000).toFixed(2)
              : '0',
          },
          'Real-time discovery complete',
        );
      }

      // Stage 2: Download pending filings
      stats.downloaded = await this.downloader.processPendingFilings(
        env.EDGAR_BATCH_SIZE,
      );
      this.logger.info({ mode: 'REALTIME', count: stats.downloaded }, 'Download complete');

      // Stage 3: Parse downloaded filings
      stats.parsed = await this.parser.parseDownloadedFilings(
        env.EDGAR_BATCH_SIZE,
      );
      this.logger.info({ mode: 'REALTIME', count: stats.parsed }, 'Parsing complete');

      // Stage 4: Extract facts from parsed filings
      stats.factsExtracted = await this.factExtractor.extractFactsFromParsedFilings(
        env.EDGAR_BATCH_SIZE,
      );
      this.logger.info({ mode: 'REALTIME', count: stats.factsExtracted }, 'Fact extraction complete');

      // Stage 5: Compute signals from facts
      stats.signals = await this.signalComputer.computeSignals();
      this.logger.info({ mode: 'REALTIME', count: stats.signals }, 'Signal computation complete');

      const duration = Date.now() - startTime;

      this.logger.info(
        {
          mode: 'REALTIME',
          stats,
          durationMs: duration,
        },
        'Real-time sync iteration complete',
      );
    } catch (error) {
      this.logger.error({ error, mode: 'REALTIME' }, 'Real-time sync iteration failed');
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
