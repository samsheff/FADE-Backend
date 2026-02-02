import { PolymarketIndexer } from '../services/market-data/polymarket-indexer.service.js';
import { MarketDataStreamService } from '../services/market-data/market-data-stream.service.js';
import { HistoricalMarketDataSync } from '../services/market-data/historical-sync.service.js';
import { getLogger } from '../utils/logger.js';
import { getEnvironment } from '../config/environment.js';

export class MarketSyncJob {
  private indexer: PolymarketIndexer;
  private historicalSync: HistoricalMarketDataSync;
  private logger;
  private intervalId: NodeJS.Timeout | null = null;
  private streamService: MarketDataStreamService | null = null;

  constructor() {
    this.indexer = new PolymarketIndexer();
    this.historicalSync = new HistoricalMarketDataSync();
    this.logger = getLogger();

    // Wire historical sync into indexer
    this.indexer.setHistoricalSync(this.historicalSync);
  }

  setStreamService(streamService: MarketDataStreamService): void {
    this.streamService = streamService;
    this.indexer.setStreamService(streamService);
  }

  async start(): Promise<void> {
    const env = getEnvironment();
    this.logger.info(
      { intervalMs: env.MARKET_SYNC_INTERVAL_MS },
      'Starting market sync job',
    );

    // Run full sync in background (don't wait)
    this.logger.info('Triggering initial full market sync');
    this.run('full')
      .then(() => {
        this.logger.info('Initial full market sync completed');
        // Run initial backfill after full sync completes
        return this.runInitialBackfill();
      })
      .catch((error) => {
        this.logger.error({ error }, 'Full sync or initial backfill failed');
      });

    // Then run incremental syncs at intervals
    this.intervalId = setInterval(() => {
      this.run('incremental').catch((error) => {
        this.logger.error({ error }, 'Incremental sync failed');
      });
    }, env.MARKET_SYNC_INTERVAL_MS);
  }

  async runInitialBackfill(): Promise<void> {
    this.logger.info('Starting initial historical backfill for pending markets');
    try {
      await this.historicalSync.backfillAllMarkets({ skipIfCompleted: true });
      this.logger.info('Initial historical backfill completed');
    } catch (error) {
      this.logger.error({ error }, 'Initial historical backfill failed');
    }
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.info('Market sync job stopped');
    }
  }

  private async run(mode: 'full' | 'incremental'): Promise<void> {
    try {
      this.logger.info({ mode }, 'Starting market sync');
      const result =
        mode === 'full'
          ? await this.indexer.fullSync()
          : await this.indexer.incrementalSync();
      this.logger.info({ mode, result }, 'Market sync completed');
    } catch (error) {
      this.logger.error({ error, mode }, 'Market sync job failed');
    }
  }
}
