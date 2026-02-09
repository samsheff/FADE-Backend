/**
 * Phase 3: Signal Generation Framework - Factor Correlation Generator
 *
 * Detects when correlated factors (gold, oil, rates, indices) have significant
 * movements and generates alerts for instruments with exposure to those factors.
 */

import { SignalGeneratorBase } from './signal-generator.base.js';
import { InstrumentRepository } from '../../../adapters/database/repositories/instrument.repository.js';
import { FactorPriceService } from '../adapters/factor-price.service.js';
import type {
  GeneratorContext,
  GeneratedSignal,
  GeneratorStats,
  FactorMovementEvidence,
} from '../types/generator.types.js';
import { logger } from '../../../utils/logger.js';

/**
 * Generator for factor correlation signals
 */
export class FactorCorrelationGenerator extends SignalGeneratorBase {
  readonly generatorName = 'FactorCorrelationGenerator';
  readonly signalType = 'FACTOR_EXPOSURE_ALERT' as const;

  private readonly instrumentRepo: InstrumentRepository;
  private readonly factorPrices: FactorPriceService;

  constructor(
    instrumentRepo: InstrumentRepository,
    factorPrices: FactorPriceService
  ) {
    super();
    this.instrumentRepo = instrumentRepo;
    this.factorPrices = factorPrices;
  }

  /**
   * Generate factor correlation signals
   *
   * Process:
   * 1. Simulate factor market movements (mock in Phase 3)
   * 2. For each moved factor, find instruments with exposure
   * 3. Create signals based on exposure magnitude and confidence
   */
  async generate(context: GeneratorContext): Promise<GeneratedSignal[]> {
    const signals: GeneratedSignal[] = [];
    const stats: GeneratorStats = {
      generatorName: this.generatorName,
      signalsGenerated: 0,
      instrumentsProcessed: 0,
      errors: 0,
      skippedLowConfidence: 0,
    };

    try {
      // Simulate factor movements (mock for Phase 3)
      const factorMovements = this.factorPrices.simulateMarketMovement();

      logger.info('Processing factor correlations', {
        movedFactors: factorMovements.size,
      });

      // Process each moved factor
      for (const [factorType, change] of factorMovements) {
        try {
          // Find instruments exposed to this factor
          const exposures =
            await this.instrumentRepo.findFactorExposures(factorType);

          logger.debug('Found factor exposures', {
            factorType,
            exposureCount: exposures.length,
            factorChangePct: change.changePct.toFixed(2),
          });

          // Create signal for each exposed instrument
          for (const exposure of exposures) {
            stats.instrumentsProcessed++;

            const signal = this.createFactorSignal(
              exposure.instrumentId,
              factorType,
              change.changePct,
              exposure.magnitude,
              exposure.direction,
              exposure.confidence,
              context
            );

            if (this.meetsConfidenceThreshold(signal.confidence)) {
              signals.push(signal);
              stats.signalsGenerated++;
            } else {
              stats.skippedLowConfidence++;
            }
          }
        } catch (error) {
          stats.errors++;
          logger.error('Error processing factor movement', {
            factorType,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      logger.info('Factor correlation generation complete', stats);
    } catch (error) {
      logger.error('Error in factor correlation generation', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      stats.errors++;
    }

    return signals;
  }

  /**
   * Create a factor correlation signal
   */
  private createFactorSignal(
    instrumentId: string,
    factorType: string,
    factorChangePct: number,
    exposureMagnitude: number,
    exposureDirection: string,
    exposureConfidence: number,
    context: GeneratorContext
  ): GeneratedSignal {
    // Calculate signal confidence
    // Combine exposure confidence, magnitude, and factor change
    const factorImpactFactor = this.normalizePercentageChange(
      factorChangePct,
      5.0 // 5% factor movement = max impact
    );
    const confidence =
      exposureConfidence * exposureMagnitude * factorImpactFactor;

    // Calculate score based on combined impact
    // Higher exposure magnitude + larger factor change = higher score
    const score = Math.min(
      exposureMagnitude * Math.abs(factorChangePct) * 10,
      100
    );

    // Determine severity
    const severity = this.calculateSeverity(score, confidence);

    // Build evidence
    const evidence: FactorMovementEvidence = {
      type: 'FACTOR_MOVEMENT',
      factorType: factorType as any, // Type assertion for FactorType
      factorChangePct,
      exposureMagnitude,
      exposureDirection,
    };

    // Build reason text
    const direction = factorChangePct > 0 ? 'up' : 'down';
    const exposureDesc = this.formatExposureDirection(exposureDirection);
    const reason = `${factorType} moved ${Math.abs(factorChangePct).toFixed(1)}% ${direction} (${exposureDesc} exposure: ${(exposureMagnitude * 100).toFixed(0)}%)`;

    return {
      instrumentId,
      signalType: this.signalType,
      severity,
      score,
      confidence,
      reason,
      evidenceFacts: [evidence],
      expiresAt: this.createExpirationDate(context.currentTime),
    };
  }

  /**
   * Format exposure direction for human-readable display
   */
  private formatExposureDirection(direction: string): string {
    switch (direction) {
      case 'POSITIVE':
        return 'positive';
      case 'NEGATIVE':
        return 'negative';
      case 'INVERSE':
        return 'inverse';
      default:
        return direction.toLowerCase();
    }
  }
}
