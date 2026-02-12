import { TranscriptsIndexerService } from '../services/transcripts/transcripts-indexer.service.js';
import { TranscriptsDownloaderService } from '../services/transcripts/transcripts-downloader.service.js';
import { TranscriptsParserService } from '../services/transcripts/transcripts-parser.service.js';
import { TranscriptsSignalExtractorService } from '../services/transcripts/transcripts-signal-extractor.service.js';
import { getEnvironment } from '../config/environment.js';
import { getLogger } from '../utils/logger.js';

export class TranscriptsWorkerJob {
  private indexer: TranscriptsIndexerService;
  private downloader: TranscriptsDownloaderService;
  private parser: TranscriptsParserService;
  private signalExtractor: TranscriptsSignalExtractorService;
  private logger;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private hasRunBackfill = false; // One-time flag

  constructor() {
    this.indexer = new TranscriptsIndexerService();
    this.downloader = new TranscriptsDownloaderService();
    this.parser = new TranscriptsParserService();
    this.signalExtractor = new TranscriptsSignalExtractorService();
    this.logger = getLogger();
  }

  /**
   * Start the job (backfill once + periodic)
   */
  async start(): Promise<void> {
    const env = getEnvironment();

    // Validate FMP API key
    if (!env.FMP_API_KEY) {
      this.logger.error(
        'TRANSCRIPTS_WORKER_ENABLED is true but FMP_API_KEY is not set. ' +
        'Get an API key at https://financialmodelingprep.com or set TRANSCRIPTS_WORKER_ENABLED=false'
      );
      throw new Error('FMP_API_KEY is required when TRANSCRIPTS_WORKER_ENABLED=true');
    }

    this.logger.info(
      {
        interval: env.TRANSCRIPTS_SYNC_INTERVAL_MS,
        batchSize: env.TRANSCRIPTS_BATCH_SIZE,
        backfillEnabled: env.TRANSCRIPTS_BACKFILL_ENABLED,
        backfillLookbackDays: env.TRANSCRIPTS_BACKFILL_LOOKBACK_DAYS,
      },
      'Starting Transcripts worker job',
    );

    // Initialize storage
    await this.downloader.init();

    // Run backfill ONCE on first startup
    if (env.TRANSCRIPTS_BACKFILL_ENABLED && !this.hasRunBackfill) {
      this.logger.info('Starting Transcripts historical backfill...');
      try {
        await this.runBackfill();
        this.logger.info('Transcripts historical backfill complete');
      } catch (error) {
        this.logger.error(
          {
            err: error,
            phase: 'BACKFILL',
            lookbackDays: env.TRANSCRIPTS_BACKFILL_LOOKBACK_DAYS,
          },
          'Transcripts backfill failed - continuing with real-time sync',
        );
      } finally {
        this.hasRunBackfill = true; // Prevent retry loop
      }
    }

    // Initial real-time run
    await this.run();

    // Schedule periodic real-time runs
    this.intervalId = setInterval(() => {
      this.run().catch((error) => {
        this.logger.error(
          { err: error, phase: 'REALTIME_SCHEDULED' },
          'Transcripts worker job error'
        );
      });
    }, env.TRANSCRIPTS_SYNC_INTERVAL_MS);

    this.logger.info('Transcripts worker job started (real-time polling)');
  }

  /**
   * Stop the job
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.info('Transcripts worker job stopped');
    }
  }

  /**
   * Historical backfill (runs once)
   */
  private async runBackfill(): Promise<void> {
    const env = getEnvironment();
    const startTime = Date.now();

    try {
      this.logger.info({ mode: 'BACKFILL' }, 'Starting historical backfill iteration');

      const stats = {
        newTranscripts: 0,
        downloaded: 0,
        parsed: 0,
        signalsExtracted: 0,
      };

      // Stage 1: Historical discovery
      const discoveryStart = Date.now();
      stats.newTranscripts = await this.indexer.backfillHistoricalTranscripts(
        env.TRANSCRIPTS_BACKFILL_LOOKBACK_DAYS,
      );
      const discoveryDuration = Date.now() - discoveryStart;

      this.logger.info(
        {
          mode: 'BACKFILL',
          count: stats.newTranscripts,
          durationMs: discoveryDuration,
          lookbackDays: env.TRANSCRIPTS_BACKFILL_LOOKBACK_DAYS,
        },
        'Historical discovery complete',
      );

      // Stage 2: Download transcripts
      stats.downloaded = await this.downloader.processPendingTranscripts(
        env.TRANSCRIPTS_BATCH_SIZE,
      );
      this.logger.info({ mode: 'BACKFILL', count: stats.downloaded }, 'Download complete');

      // Stage 3: Parse transcripts
      stats.parsed = await this.parser.processDownloadedTranscripts(
        env.TRANSCRIPTS_BATCH_SIZE,
      );
      this.logger.info({ mode: 'BACKFILL', count: stats.parsed }, 'Parse complete');

      // Stage 4: Extract signals
      stats.signalsExtracted = await this.signalExtractor.processParsedTranscripts(
        env.TRANSCRIPTS_BATCH_SIZE,
      );
      this.logger.info(
        { mode: 'BACKFILL', count: stats.signalsExtracted },
        'Signal extraction complete',
      );

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
      this.logger.error(
        { err: error, mode: 'BACKFILL', lookbackDays: env.TRANSCRIPTS_BACKFILL_LOOKBACK_DAYS },
        'Historical backfill iteration failed',
      );
      throw error;
    }
  }

  /**
   * Real-time sync iteration
   */
  private async run(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Transcripts worker already running, skipping this iteration');
      return;
    }

    this.isRunning = true;
    const env = getEnvironment();
    const startTime = Date.now();

    try {
      this.logger.info({ mode: 'REALTIME' }, 'Starting real-time sync iteration');

      const stats = {
        newTranscripts: 0,
        downloaded: 0,
        parsed: 0,
        signalsExtracted: 0,
      };

      // Stage 1: Incremental discovery
      const discoveryStart = Date.now();
      stats.newTranscripts = await this.indexer.discoverRecentTranscripts();
      const discoveryDuration = Date.now() - discoveryStart;

      this.logger.info(
        {
          mode: 'REALTIME',
          count: stats.newTranscripts,
          durationMs: discoveryDuration,
        },
        'Real-time discovery complete',
      );

      // Stage 2: Download
      stats.downloaded = await this.downloader.processPendingTranscripts(
        env.TRANSCRIPTS_BATCH_SIZE,
      );
      this.logger.info({ mode: 'REALTIME', count: stats.downloaded }, 'Download complete');

      // Stage 3: Parse
      stats.parsed = await this.parser.processDownloadedTranscripts(
        env.TRANSCRIPTS_BATCH_SIZE,
      );
      this.logger.info({ mode: 'REALTIME', count: stats.parsed }, 'Parse complete');

      // Stage 4: Extract signals
      stats.signalsExtracted = await this.signalExtractor.processParsedTranscripts(
        env.TRANSCRIPTS_BATCH_SIZE,
      );
      this.logger.info(
        { mode: 'REALTIME', count: stats.signalsExtracted },
        'Signal extraction complete',
      );

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
      this.logger.error({ err: error, mode: 'REALTIME' }, 'Real-time sync iteration failed');
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Run one iteration manually
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
