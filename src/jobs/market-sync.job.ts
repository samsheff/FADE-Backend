import { MarketDataService } from '../services/market-data/market-data.service.js';
import { getLogger } from '../utils/logger.js';
import { getEnvironment } from '../config/environment.js';

export class MarketSyncJob {
  private marketDataService: MarketDataService;
  private logger;
  private intervalId: NodeJS.Timeout | null = null;

  constructor() {
    this.marketDataService = new MarketDataService();
    this.logger = getLogger();
  }

  start(): void {
    const env = getEnvironment();
    this.logger.info(
      { intervalMs: env.MARKET_SYNC_INTERVAL_MS },
      'Starting market sync job',
    );

    // Run immediately on start
    this.run();

    // Then run at intervals
    this.intervalId = setInterval(() => {
      this.run();
    }, env.MARKET_SYNC_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.info('Market sync job stopped');
    }
  }

  private async run(): Promise<void> {
    try {
      this.logger.debug('Market sync job running');
      const updated = await this.marketDataService.syncMarketsFromPolymarket();
      this.logger.info({ updated }, 'Market sync completed');
    } catch (error) {
      this.logger.error({ error }, 'Market sync job failed');
    }
  }
}
