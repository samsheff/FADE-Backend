/**
 * Phase 3: Signal Generation Framework - Competitor Impact Generator
 *
 * Detects when peer companies have significant price movements and generates
 * alerts for related instruments based on competitor relationships.
 */

import { SignalGeneratorBase } from './signal-generator.base.js';
import { InstrumentRepository } from '../../../adapters/database/repositories/instrument.repository.js';
import { PriceTrackerService } from '../adapters/price-tracker.service.js';
import type {
  GeneratorContext,
  GeneratedSignal,
  GeneratorStats,
  PeerPriceMovementEvidence,
} from '../types/generator.types.js';
import { logger } from '../../../utils/logger.js';

/**
 * Generator for competitor impact signals
 */
export class CompetitorImpactGenerator extends SignalGeneratorBase {
  readonly generatorName = 'CompetitorImpactGenerator';
  readonly signalType = 'PEER_IMPACT' as const;

  private readonly instrumentRepo: InstrumentRepository;
  private readonly priceTracker: PriceTrackerService;

  constructor(
    instrumentRepo: InstrumentRepository,
    priceTracker: PriceTrackerService
  ) {
    super();
    this.instrumentRepo = instrumentRepo;
    this.priceTracker = priceTracker;
  }

  /**
   * Generate competitor impact signals
   *
   * Process:
   * 1. Get all instruments with significant price movements (>5%)
   * 2. For each moved instrument, find its competitors
   * 3. Create signals for competitors based on relationship confidence
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
      // Get all significant price movements
      const priceChanges = await this.priceTracker.updateAllPrices();

      logger.info('Processing competitor impacts', {
        significantMovements: priceChanges.size,
      });

      // Process each moved instrument
      for (const [movedInstrumentId, change] of priceChanges) {
        try {
          stats.instrumentsProcessed++;

          // Find competitors of the moved instrument
          const competitors =
            await this.instrumentRepo.findCompetitors(movedInstrumentId);

          logger.debug('Found competitors for moved instrument', {
            movedInstrumentId,
            competitorCount: competitors.length,
            priceChangePct: change.changePct.toFixed(2),
          });

          // Create signal for each competitor
          for (const competitor of competitors) {
            const signal = this.createCompetitorSignal(
              competitor.competitorId,
              movedInstrumentId,
              change.changePct,
              competitor.confidence,
              competitor.relationshipType,
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
          logger.error('Error processing moved instrument', {
            instrumentId: movedInstrumentId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      logger.info('Competitor impact generation complete', stats);
    } catch (error) {
      logger.error('Error in competitor impact generation', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      stats.errors++;
    }

    return signals;
  }

  /**
   * Create a competitor impact signal
   */
  private createCompetitorSignal(
    targetInstrumentId: string,
    peerInstrumentId: string,
    priceChangePct: number,
    relationshipConfidence: number,
    relationshipType: string,
    context: GeneratorContext
  ): GeneratedSignal {
    // Calculate signal confidence
    // Combine relationship confidence with magnitude of price change
    const priceImpactFactor = this.normalizePercentageChange(
      priceChangePct,
      10.0 // 10% movement = max impact
    );
    const confidence = relationshipConfidence * priceImpactFactor;

    // Calculate score (0-100) based on price change magnitude
    const score = Math.min(Math.abs(priceChangePct) * 10, 100);

    // Determine severity
    const severity = this.calculateSeverity(score, confidence);

    // Build evidence
    const evidence: PeerPriceMovementEvidence = {
      type: 'PEER_PRICE_MOVEMENT',
      peerInstrumentId,
      peerSymbol: peerInstrumentId, // TODO: Resolve to actual symbol
      priceChangePct,
      correlationStrength: relationshipConfidence,
    };

    // Build reason text
    const direction = priceChangePct > 0 ? 'up' : 'down';
    const reason = `Competitor moved ${Math.abs(priceChangePct).toFixed(1)}% ${direction} (${relationshipType} relationship)`;

    return {
      instrumentId: targetInstrumentId,
      signalType: this.signalType,
      severity,
      score,
      confidence,
      reason,
      evidenceFacts: [evidence],
      expiresAt: this.createExpirationDate(context.currentTime),
    };
  }
}
