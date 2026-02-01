import { PositionTrackingService } from '../services/position-tracking/position-tracking.service.js';
import { getLogger } from '../utils/logger.js';
import { getEnvironment } from '../config/environment.js';

export class PositionUpdateJob {
  private positionService: PositionTrackingService;
  private logger;
  private intervalId: NodeJS.Timeout | null = null;

  constructor() {
    this.positionService = new PositionTrackingService();
    this.logger = getLogger();
  }

  start(): void {
    const env = getEnvironment();
    this.logger.info(
      { intervalMs: env.POSITION_UPDATE_INTERVAL_MS },
      'Starting position update job',
    );

    // Run immediately on start
    this.run();

    // Then run at intervals
    this.intervalId = setInterval(() => {
      this.run();
    }, env.POSITION_UPDATE_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.info('Position update job stopped');
    }
  }

  private async run(): Promise<void> {
    try {
      this.logger.debug('Position update job running');
      const updated = await this.positionService.updateAllPositions();
      this.logger.info({ updated }, 'Position update completed');
    } catch (error) {
      this.logger.error({ error }, 'Position update job failed');
    }
  }
}
