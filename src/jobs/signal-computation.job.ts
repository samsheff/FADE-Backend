/**
 * Phase 3: Signal Generation Framework - Signal Computation Job
 *
 * Background job that runs signal generators on a scheduled interval.
 * Follows EntityEnrichmentJob pattern with re-entrancy protection.
 */

import { SignalComputationService } from '../services/signals/signal-computation.service.js';
import { PriceTrackerService } from '../services/signals/adapters/price-tracker.service.js';
import { FactorPriceService } from '../services/signals/adapters/factor-price.service.js';
import { CompetitorImpactGenerator } from '../services/signals/generators/competitor-impact.generator.js';
import { FactorCorrelationGenerator } from '../services/signals/generators/factor-correlation.generator.js';
import { CrossEntityPropagationGenerator } from '../services/signals/generators/cross-entity-propagation.generator.js';
import { ArbitrageBreakdownGenerator } from '../services/signals/generators/etf-arbitrage-breakdown.generator.js';
import { APFragilityGenerator } from '../services/signals/generators/etf-ap-fragility.generator.js';
import { MarketRepository } from '../adapters/database/repositories/market.repository.js';
import { InstrumentRepository } from '../adapters/database/repositories/instrument.repository.js';
import { SignalRepository } from '../adapters/database/repositories/signal.repository.js';
import { EtfNavDataService } from '../services/etf/etf-nav-data.service.js';
import { EtfMetricsRepository } from '../adapters/database/repositories/etf-metrics.repository.js';
import { getPrismaClient } from '../adapters/database/client.js';
import { env } from '../config/environment.js';
import { logger } from '../utils/logger.js';

/**
 * Job status information
 */
interface JobStatus {
  running: boolean;
  hasScheduledRuns: boolean;
  lastRunTime?: Date;
  nextRunTime?: Date;
}

/**
 * Background job for signal computation
 */
export class SignalComputationJob {
  private readonly service: SignalComputationService;
  private intervalId?: NodeJS.Timeout;
  private isRunning = false;
  private lastRunTime?: Date;

  constructor() {
    // Instantiate repositories
    const prisma = getPrismaClient();
    const marketRepo = new MarketRepository();
    const instrumentRepo = new InstrumentRepository();
    const signalRepo = new SignalRepository();
    const etfMetricsRepo = new EtfMetricsRepository(prisma);

    // Instantiate services
    const priceTracker = new PriceTrackerService(marketRepo, instrumentRepo);
    const factorPrices = new FactorPriceService();
    const etfNavService = new EtfNavDataService(prisma);

    // Instantiate computation service
    this.service = new SignalComputationService(
      priceTracker,
      factorPrices,
      signalRepo
    );

    // Register all generators
    this.service.registerGenerator(
      new CompetitorImpactGenerator(instrumentRepo, priceTracker)
    );
    this.service.registerGenerator(
      new FactorCorrelationGenerator(instrumentRepo, factorPrices)
    );
    this.service.registerGenerator(
      new CrossEntityPropagationGenerator(instrumentRepo, signalRepo)
    );
    this.service.registerGenerator(
      new ArbitrageBreakdownGenerator(instrumentRepo, etfNavService)
    );
    this.service.registerGenerator(
      new APFragilityGenerator(instrumentRepo, etfMetricsRepo)
    );

    logger.info('Signal computation job initialized', {
      generators: this.service.getRegisteredGenerators().length,
    });
  }

  /**
   * Start the job (immediate run + scheduled interval)
   */
  async start(): Promise<void> {
    if (!env.SIGNAL_COMPUTATION_ENABLED) {
      logger.info('Signal computation job disabled by configuration');
      return;
    }

    if (this.intervalId) {
      logger.warn('Signal computation job already running');
      return;
    }

    logger.info('Starting signal computation job', {
      intervalMs: env.SIGNAL_COMPUTATION_INTERVAL_MS,
    });

    // Run immediately on startup
    await this.run();

    // Schedule recurring runs
    this.intervalId = setInterval(() => {
      this.run().catch((error) => {
        logger.error('Scheduled signal computation run failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    }, env.SIGNAL_COMPUTATION_INTERVAL_MS);

    logger.info('Signal computation job started');
  }

  /**
   * Stop the job
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      logger.info('Signal computation job stopped');
    }
  }

  /**
   * Run the job once (with re-entrancy guard)
   *
   * @returns Job statistics
   */
  async run(): Promise<void> {
    // Re-entrancy guard
    if (this.isRunning) {
      logger.warn('Signal computation already in progress, skipping run');
      return;
    }

    this.isRunning = true;

    try {
      logger.info('Starting signal computation run');

      const stats = await this.service.computeSignals();

      this.lastRunTime = new Date();

      logger.info('Signal computation run complete', {
        totalSignalsGenerated: stats.totalSignalsGenerated,
        totalErrors: stats.totalErrors,
        durationMs: stats.durationMs,
      });
    } catch (error) {
      logger.error('Signal computation run failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Run the job once manually (for testing)
   */
  async runOnce(): Promise<void> {
    await this.run();
  }

  /**
   * Get job status
   */
  getStatus(): JobStatus {
    const status: JobStatus = {
      running: this.isRunning,
      hasScheduledRuns: !!this.intervalId,
      lastRunTime: this.lastRunTime,
    };

    if (this.intervalId && this.lastRunTime) {
      status.nextRunTime = new Date(
        this.lastRunTime.getTime() + env.SIGNAL_COMPUTATION_INTERVAL_MS
      );
    }

    return status;
  }
}
