/**
 * Phase 3: Signal Generation Framework - Cross-Entity Propagation Generator
 *
 * Propagates EDGAR-derived risk signals (dilution, toxic financing, distress)
 * to competitor companies based on relationship confidence.
 */

import { SignalGeneratorBase } from './signal-generator.base.js';
import { InstrumentRepository } from '../../../adapters/database/repositories/instrument.repository.js';
import { SignalRepository } from '../../../adapters/database/repositories/signal.repository.js';
import type {
  GeneratorContext,
  GeneratedSignal,
  GeneratorStats,
  PropagatedSignalEvidence,
} from '../types/generator.types.js';
import { SignalType } from '../../../types/edgar.types.js';
import { logger } from '../../../utils/logger.js';

/**
 * Signal types that should be propagated to competitors
 */
const PROPAGATABLE_SIGNAL_TYPES: SignalType[] = [
  'DILUTION_RISK',
  'TOXIC_FINANCING_RISK',
  'DISTRESS_RISK',
];

/**
 * Generator for cross-entity signal propagation
 */
export class CrossEntityPropagationGenerator extends SignalGeneratorBase {
  readonly generatorName = 'CrossEntityPropagationGenerator';
  readonly signalType = 'PEER_IMPACT' as const;

  private readonly instrumentRepo: InstrumentRepository;
  private readonly signalRepo: SignalRepository;

  /**
   * Decay factor for propagated signals (20% confidence reduction)
   */
  private readonly propagationDecay = 0.8;

  constructor(
    instrumentRepo: InstrumentRepository,
    signalRepo: SignalRepository
  ) {
    super();
    this.instrumentRepo = instrumentRepo;
    this.signalRepo = signalRepo;
  }

  /**
   * Generate propagated signals
   *
   * Process:
   * 1. Query recent EDGAR signals within lookback window
   * 2. For each signal, find competitors of source instrument
   * 3. Propagate signal to competitors with reduced confidence
   * 4. Skip duplicates (check for existing propagation from same source)
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
      // Calculate lookback time
      const lookbackTime = new Date(
        context.currentTime.getTime() - context.lookbackWindowMs
      );

      // Query recent EDGAR signals
      const recentSignals = await this.queryRecentEdgarSignals(lookbackTime);

      logger.info('Processing signal propagation', {
        recentSignals: recentSignals.length,
        lookbackWindow: `${context.lookbackWindowMs / (60 * 60 * 1000)}h`,
      });

      // Process each source signal
      for (const sourceSignal of recentSignals) {
        try {
          stats.instrumentsProcessed++;

          // Find competitors of the signal's instrument
          const competitors = await this.instrumentRepo.findCompetitors(
            sourceSignal.instrumentId
          );

          logger.debug('Found competitors for signal propagation', {
            sourceInstrumentId: sourceSignal.instrumentId,
            sourceSignalType: sourceSignal.signalType,
            competitorCount: competitors.length,
          });

          // Propagate to each competitor
          for (const competitor of competitors) {
            // Check if we already propagated this signal to this competitor
            if (
              await this.isDuplicatePropagation(
                competitor.competitorId,
                sourceSignal.id
              )
            ) {
              continue;
            }

            const signal = this.createPropagatedSignal(
              competitor.competitorId,
              sourceSignal.id,
              sourceSignal.instrumentId,
              sourceSignal.signalType,
              sourceSignal.confidence,
              competitor.confidence,
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
          logger.error('Error propagating signal', {
            signalId: sourceSignal.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      logger.info('Signal propagation complete', stats);
    } catch (error) {
      logger.error('Error in signal propagation generation', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      stats.errors++;
    }

    return signals;
  }

  /**
   * Query recent EDGAR signals that should be propagated
   */
  private async queryRecentEdgarSignals(since: Date) {
    const allSignals: Array<{
      id: string;
      instrumentId: string;
      signalType: SignalType;
      confidence: number;
      computedAt: Date;
    }> = [];

    // Query each propagatable signal type
    for (const signalType of PROPAGATABLE_SIGNAL_TYPES) {
      const signals = await this.signalRepo.findRecentSignals(
        signalType,
        since
      );

      allSignals.push(
        ...signals.map((s) => ({
          id: s.id,
          instrumentId: s.instrumentId,
          signalType: s.signalType,
          confidence: s.confidence,
          computedAt: s.computedAt,
        }))
      );
    }

    return allSignals;
  }

  /**
   * Check if a signal has already been propagated to a competitor
   */
  private async isDuplicatePropagation(
    targetInstrumentId: string,
    sourceSignalId: string
  ): Promise<boolean> {
    // Query existing signals for this instrument
    const existingSignals =
      await this.signalRepo.findByInstrument(targetInstrumentId);

    // Check if any have evidenceFacts pointing to the source signal
    for (const signal of existingSignals) {
      if (!signal.evidenceFacts || signal.evidenceFacts.length === 0) {
        continue;
      }

      for (const fact of signal.evidenceFacts) {
        if (
          fact.type === 'PROPAGATED_SIGNAL' &&
          (fact as any).sourceSignalId === sourceSignalId
        ) {
          return true; // Duplicate found
        }
      }
    }

    return false;
  }

  /**
   * Create a propagated signal
   */
  private createPropagatedSignal(
    targetInstrumentId: string,
    sourceSignalId: string,
    sourceInstrumentId: string,
    sourceSignalType: SignalType,
    sourceConfidence: number,
    relationshipConfidence: number,
    context: GeneratorContext
  ): GeneratedSignal {
    // Calculate propagated confidence with decay
    const confidence = this.calculatePropagatedConfidence(
      sourceConfidence,
      relationshipConfidence,
      this.propagationDecay
    );

    // Score is based on original signal confidence
    const score = sourceConfidence * 100;

    // Determine severity
    const severity = this.calculateSeverity(score, confidence);

    // Build evidence
    const evidence: PropagatedSignalEvidence = {
      type: 'PROPAGATED_SIGNAL',
      sourceSignalId,
      sourceInstrumentId,
      sourceSignalType,
      originalConfidence: sourceConfidence,
    };

    // Build reason text
    const reason = `Competitor has ${this.formatSignalType(sourceSignalType)} (propagated from peer company)`;

    return {
      instrumentId: targetInstrumentId,
      signalType: this.signalType, // Use PEER_IMPACT for propagated signals
      severity,
      score,
      confidence,
      reason,
      evidenceFacts: [evidence],
      expiresAt: this.createExpirationDate(context.currentTime),
    };
  }

  /**
   * Format signal type for human-readable display
   */
  private formatSignalType(signalType: SignalType): string {
    return signalType
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
