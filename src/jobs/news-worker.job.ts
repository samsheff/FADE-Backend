import { NewsIndexerService } from '../services/news/news-indexer.service.js';
import { NewsDownloaderService } from '../services/news/news-downloader.service.js';
import { NewsSignalExtractorService } from '../services/news/news-signal-extractor.service.js';
import { getEnvironment } from '../config/environment.js';
import { getLogger } from '../utils/logger.js';

/**
 * News Worker Job (Dual-Path Orchestration)
 *
 * Orchestrates two ingestion paths:
 * 1. Historical Backfill (runs once on startup) → Finnhub API (lookback window)
 * 2. Real-Time Discovery (periodic polling) → Finnhub API (last 24h)
 *
 * Both paths feed into the same pipeline:
 * discover → download → extract signals
 */
export class NewsWorkerJob {
  private indexer: NewsIndexerService;
  private downloader: NewsDownloaderService;
  private signalExtractor: NewsSignalExtractorService;
  private logger;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private hasRunBackfill = false; // In-memory flag for one-time backfill

  constructor() {
    this.indexer = new NewsIndexerService();
    this.downloader = new NewsDownloaderService();
    this.signalExtractor = new NewsSignalExtractorService();
    this.logger = getLogger();
  }

  /**
   * Start the News worker job
   *
   * Runs historical backfill ONCE on first startup,
   * then continues with periodic real-time polling.
   */
  async start(): Promise<void> {
    const env = getEnvironment();

    // Validate configuration
    if (!env.FINNHUB_API_KEY) {
      this.logger.error(
        'NEWS_WORKER_ENABLED is true but FINNHUB_API_KEY is not set. ' +
        'Get a free API key at https://finnhub.io/register or set NEWS_WORKER_ENABLED=false'
      );
      throw new Error('FINNHUB_API_KEY is required when NEWS_WORKER_ENABLED=true');
    }

    this.logger.info(
      {
        interval: env.NEWS_SYNC_INTERVAL_MS,
        batchSize: env.NEWS_BATCH_SIZE,
        backfillEnabled: env.NEWS_BACKFILL_ENABLED,
        backfillLookbackDays: env.NEWS_BACKFILL_LOOKBACK_DAYS,
      },
      'Starting News worker job',
    );

    // Initialize storage
    await this.downloader.init();

    // Run backfill ONCE on first startup
    if (env.NEWS_BACKFILL_ENABLED && !this.hasRunBackfill) {
      this.logger.info('Starting News historical backfill...');
      await this.runBackfill();
      this.hasRunBackfill = true;
      this.logger.info('News historical backfill complete');
    }

    // Initial real-time run
    await this.run();

    // Schedule periodic real-time runs
    this.intervalId = setInterval(() => {
      this.run().catch((error) => {
        this.logger.error({ error }, 'News worker job error');
      });
    }, env.NEWS_SYNC_INTERVAL_MS);

    this.logger.info('News worker job started (real-time polling)');
  }

  /**
   * Stop the News worker job
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.info('News worker job stopped');
    }
  }

  /**
   * Run historical backfill (one-time on startup)
   *
   * Stage 1: Historical discovery via Finnhub API
   * Stages 2-3: Process backfilled articles (download/extract)
   */
  private async runBackfill(): Promise<void> {
    const env = getEnvironment();
    const startTime = Date.now();

    try {
      this.logger.info({ mode: 'BACKFILL' }, 'Starting historical backfill iteration');

      const stats = {
        newArticles: 0,
        downloaded: 0,
        signalsExtracted: 0,
      };

      // Stage 1: Historical backfill discovery
      const discoveryStart = Date.now();
      stats.newArticles = await this.indexer.backfillHistoricalNews(
        env.NEWS_BACKFILL_LOOKBACK_DAYS,
      );
      const discoveryDuration = Date.now() - discoveryStart;

      this.logger.info(
        {
          mode: 'BACKFILL',
          count: stats.newArticles,
          durationMs: discoveryDuration,
          lookbackDays: env.NEWS_BACKFILL_LOOKBACK_DAYS,
        },
        'Historical discovery complete',
      );

      // Stage 2: Download articles
      stats.downloaded = await this.downloader.processPendingArticles(
        env.NEWS_BATCH_SIZE,
      );
      this.logger.info({ mode: 'BACKFILL', count: stats.downloaded }, 'Download complete');

      // Stage 3: Extract signals
      stats.signalsExtracted = await this.signalExtractor.processDownloadedArticles(
        env.NEWS_BATCH_SIZE,
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
      this.logger.error({ error, mode: 'BACKFILL' }, 'Historical backfill iteration failed');
      throw error;
    }
  }

  /**
   * Run one iteration of real-time pipeline
   *
   * Stage 1: Real-time discovery (last 24h)
   * Stages 2-3: Process new articles (download/extract)
   */
  private async run(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('News worker already running, skipping this iteration');
      return;
    }

    this.isRunning = true;
    const env = getEnvironment();
    const startTime = Date.now();

    try {
      this.logger.info({ mode: 'REALTIME' }, 'Starting real-time sync iteration');

      const stats = {
        newArticles: 0,
        downloaded: 0,
        signalsExtracted: 0,
      };

      // Stage 1: Real-time discovery (last 24h)
      const discoveryStart = Date.now();
      stats.newArticles = await this.indexer.discoverRecentNews();
      const discoveryDuration = Date.now() - discoveryStart;

      this.logger.info(
        {
          mode: 'REALTIME',
          count: stats.newArticles,
          durationMs: discoveryDuration,
          articlesPerSec: stats.newArticles > 0
            ? ((stats.newArticles / discoveryDuration) * 1000).toFixed(2)
            : '0',
        },
        'Real-time discovery complete',
      );

      // Stage 2: Download pending articles
      stats.downloaded = await this.downloader.processPendingArticles(
        env.NEWS_BATCH_SIZE,
      );
      this.logger.info({ mode: 'REALTIME', count: stats.downloaded }, 'Download complete');

      // Stage 3: Extract signals from downloaded articles
      stats.signalsExtracted = await this.signalExtractor.processDownloadedArticles(
        env.NEWS_BATCH_SIZE,
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
