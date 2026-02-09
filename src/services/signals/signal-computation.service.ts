/**
 * Phase 3: Signal Generation Framework - Signal Computation Service
 *
 * Orchestrates multiple signal generators to produce actionable trading alerts.
 * Handles price updates, generator coordination, signal persistence, and cleanup.
 */

import { SignalGeneratorBase } from './generators/signal-generator.base.js';
import { PriceTrackerService } from './adapters/price-tracker.service.js';
import { FactorPriceService } from './adapters/factor-price.service.js';
import { SignalRepository } from '../../adapters/database/repositories/signal.repository.js';
import type {
  GeneratorContext,
  GeneratedSignal,
  ComputationJobStats,
} from './types/generator.types.js';
import { env } from '../../config/environment.js';
import { logger } from '../../utils/logger.js';

/**
 * Service for orchestrating signal generation
 */
export class SignalComputationService {
  private readonly generators: SignalGeneratorBase[] = [];
  private readonly priceTracker: PriceTrackerService;
  private readonly factorPrices: FactorPriceService;
  private readonly signalRepo: SignalRepository;

  constructor(
    priceTracker: PriceTrackerService,
    factorPrices: FactorPriceService,
    signalRepo: SignalRepository
  ) {
    this.priceTracker = priceTracker;
    this.factorPrices = factorPrices;
    this.signalRepo = signalRepo;
  }

  /**
   * Register a signal generator
   *
   * @param generator - Generator to add to the pipeline
   */
  registerGenerator(generator: SignalGeneratorBase): void {
    this.generators.push(generator);
    logger.info('Registered signal generator', {
      generatorName: generator.generatorName,
      signalType: generator.signalType,
    });
  }

  /**
   * Compute signals from all registered generators
   *
   * Process:
   * 1. Update price snapshots (instruments and factors)
   * 2. Build generator context
   * 3. Run each generator
   * 4. Persist signals with deduplication
   * 5. Cleanup expired signals and stale snapshots
   *
   * @returns Job statistics
   */
  async computeSignals(): Promise<ComputationJobStats> {
    const startTime = Date.now();
    const currentTime = new Date();

    // Initialize stats
    const stats: ComputationJobStats = {
      totalSignalsGenerated: 0,
      totalInstrumentsProcessed: 0,
      totalErrors: 0,
      generatorStats: [],
      durationMs: 0,
    };

    try {
      logger.info('Starting signal computation run', {
        registeredGenerators: this.generators.length,
      });

      // Build generator context
      const context: GeneratorContext = {
        currentTime,
        lookbackWindowMs: 24 * 60 * 60 * 1000, // 24 hours
      };

      // Run each generator
      for (const generator of this.generators) {
        try {
          logger.info('Running generator', {
            generatorName: generator.generatorName,
          });

          const signals = await generator.generate(context);

          logger.info('Generator complete', {
            generatorName: generator.generatorName,
            signalsGenerated: signals.length,
          });

          // Persist signals
          await this.persistSignals(signals);

          // Update stats (generators should track their own stats internally)
          stats.totalSignalsGenerated += signals.length;
        } catch (error) {
          stats.totalErrors++;
          logger.error('Generator failed', {
            generatorName: generator.generatorName,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // Cleanup expired signals
      await this.cleanupExpiredSignals();

      // Cleanup stale price snapshots
      this.priceTracker.clearStaleSnapshots();

      // Calculate duration
      stats.durationMs = Date.now() - startTime;

      logger.info('Signal computation run complete', {
        totalSignalsGenerated: stats.totalSignalsGenerated,
        totalErrors: stats.totalErrors,
        durationMs: stats.durationMs,
      });
    } catch (error) {
      logger.error('Error in signal computation', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      stats.totalErrors++;
    }

    return stats;
  }

  /**
   * Persist signals to database with deduplication
   *
   * Uses upsertSignal to update existing signals or create new ones.
   * Deduplication key: instrumentId + signalType
   */
  private async persistSignals(signals: GeneratedSignal[]): Promise<void> {
    let successCount = 0;
    let errorCount = 0;

    for (const signal of signals) {
      try {
        await this.signalRepo.upsertSignal({
          instrumentId: signal.instrumentId,
          signalType: signal.signalType,
          severity: signal.severity,
          score: signal.score,
          confidence: signal.confidence,
          reason: signal.reason,
          evidenceFacts: signal.evidenceFacts as any[], // Type assertion for Prisma Json
          computedAt: new Date(),
          expiresAt: signal.expiresAt,
        });

        successCount++;
      } catch (error) {
        errorCount++;
        logger.error('Error persisting signal', {
          instrumentId: signal.instrumentId,
          signalType: signal.signalType,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    logger.info('Signal persistence complete', {
      total: signals.length,
      success: successCount,
      errors: errorCount,
    });
  }

  /**
   * Remove expired signals from database
   */
  private async cleanupExpiredSignals(): Promise<void> {
    try {
      const deletedCount = await this.signalRepo.expireOldSignals();

      if (deletedCount > 0) {
        logger.info('Cleaned up expired signals', { count: deletedCount });
      }
    } catch (error) {
      logger.error('Error cleaning up expired signals', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Get list of registered generators
   */
  getRegisteredGenerators(): Array<{
    name: string;
    signalType: string;
  }> {
    return this.generators.map((g) => ({
      name: g.generatorName,
      signalType: g.signalType,
    }));
  }
}
