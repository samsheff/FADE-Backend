import { EdgarUniverseDiscoveryService } from '../services/edgar/universe-discovery.service.js';
import { getEnvironment } from '../config/environment.js';
import { getLogger } from '../utils/logger.js';

/**
 * EDGAR Universe Discovery Job
 * Syncs the complete SEC issuer universe (~13k companies) on a daily schedule
 */
export class EdgarUniverseDiscoveryJob {
  private universeService: EdgarUniverseDiscoveryService;
  private logger;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor() {
    this.universeService = new EdgarUniverseDiscoveryService();
    this.logger = getLogger();
  }

  /**
   * Start the universe discovery job
   * Runs initial sync then schedules periodic runs
   */
  async start(): Promise<void> {
    const env = getEnvironment();
    this.logger.info(
      {
        interval: env.EDGAR_UNIVERSE_SYNC_INTERVAL_MS,
      },
      'Starting EDGAR universe discovery job',
    );

    // Initial run
    await this.run();

    // Schedule periodic runs
    this.intervalId = setInterval(() => {
      this.run().catch((error) => {
        this.logger.error({ error }, 'EDGAR universe discovery job error');
      });
    }, env.EDGAR_UNIVERSE_SYNC_INTERVAL_MS);

    this.logger.info('EDGAR universe discovery job started');
  }

  /**
   * Stop the universe discovery job
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.info('EDGAR universe discovery job stopped');
    }
  }

  /**
   * Run one iteration of universe discovery
   */
  private async run(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'Universe discovery already running, skipping this iteration',
      );
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      this.logger.info('Starting universe discovery iteration');

      const result = await this.universeService.discoverUniverse();

      const duration = Date.now() - startTime;

      this.logger.info(
        {
          totalIssuers: result.totalIssuers,
          newIssuers: result.newIssuers,
          updatedIssuers: result.updatedIssuers,
          durationMs: duration,
        },
        'Universe discovery iteration complete',
      );
    } catch (error) {
      this.logger.error({ error }, 'Universe discovery iteration failed');
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
