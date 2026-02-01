import { PolymarketIndexer } from '../services/market-data/polymarket-indexer.service.js';
import { getLogger } from '../utils/logger.js';
import { getEnvironment } from '../config/environment.js';

export class MarketSyncJob {
  private indexer: PolymarketIndexer;
  private logger;
  private intervalId: NodeJS.Timeout | null = null;

  constructor() {
    this.indexer = new PolymarketIndexer();
    this.logger = getLogger();
  }

  start(): void {
    const env = getEnvironment();
    this.logger.info(
      { intervalMs: env.MARKET_SYNC_INTERVAL_MS },
      'Starting market sync job',
    );

    // Run immediately on start with a full sync
    this.run('full');

    // Then run at intervals
    this.intervalId = setInterval(() => {
      this.run('incremental');
    }, env.MARKET_SYNC_INTERVAL_MS);
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
      this.logger.debug({ mode }, 'Market sync job running');
      const result =
        mode === 'full'
          ? await this.indexer.fullSync()
          : await this.indexer.incrementalSync();
      this.logger.info({ mode, result }, 'Market sync completed');
    } catch (error) {
      this.logger.error({ error }, 'Market sync job failed');
    }
  }
}
