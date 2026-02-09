/**
 * Phase 3: Signal Generation Framework - Abstract Base Generator
 *
 * Base class for all signal generators. Provides common utilities for
 * confidence checking, severity calculation, and expiration date management.
 */

import { SignalType, SignalSeverity } from '../../../types/edgar.types.js';
import { env } from '../../../config/environment.js';
import type {
  GeneratorContext,
  GeneratedSignal,
} from '../types/generator.types.js';

/**
 * Abstract base class for signal generators
 */
export abstract class SignalGeneratorBase {
  /**
   * Name of this generator (for logging/stats)
   */
  abstract readonly generatorName: string;

  /**
   * Primary signal type this generator creates
   */
  abstract readonly signalType: SignalType;

  /**
   * Generate signals based on current market conditions and entity data
   *
   * @param context - Computation context (time, lookback window)
   * @returns Array of generated signals
   */
  abstract generate(context: GeneratorContext): Promise<GeneratedSignal[]>;

  /**
   * Check if a confidence value meets the configured minimum threshold
   *
   * @param confidence - Confidence value (0-1)
   * @returns True if confidence is high enough
   */
  protected meetsConfidenceThreshold(confidence: number): boolean {
    return confidence >= env.SIGNAL_MIN_CONFIDENCE_THRESHOLD;
  }

  /**
   * Map numeric score and confidence to severity level
   *
   * @param score - Signal score (0-100)
   * @param confidence - Confidence value (0-1)
   * @returns Severity level
   */
  protected calculateSeverity(
    score: number,
    confidence: number
  ): SignalSeverity {
    // Weight score by confidence
    const weightedScore = score * confidence;

    if (weightedScore >= 80) {
      return 'CRITICAL';
    } else if (weightedScore >= 60) {
      return 'HIGH';
    } else if (weightedScore >= 40) {
      return 'MEDIUM';
    } else {
      return 'LOW';
    }
  }

  /**
   * Create expiration timestamp based on configured retention period
   *
   * @param baseTime - Base time to calculate from (typically current time)
   * @returns Expiration date
   */
  protected createExpirationDate(baseTime: Date): Date {
    const expirationMs =
      baseTime.getTime() + env.SIGNAL_EXPIRATION_DAYS * 24 * 60 * 60 * 1000;
    return new Date(expirationMs);
  }

  /**
   * Calculate confidence for propagated signals with decay factor
   *
   * @param originalConfidence - Confidence of source signal
   * @param relationshipConfidence - Confidence of relationship
   * @param decayFactor - Decay multiplier (e.g., 0.8 for 20% reduction)
   * @returns Propagated confidence
   */
  protected calculatePropagatedConfidence(
    originalConfidence: number,
    relationshipConfidence: number,
    decayFactor = 0.8
  ): number {
    return originalConfidence * decayFactor * relationshipConfidence;
  }

  /**
   * Normalize a percentage change to a 0-1 scale
   *
   * @param changePct - Percentage change (e.g., -7.5)
   * @param maxPct - Maximum percentage for normalization (e.g., 10)
   * @returns Normalized value capped at 1.0
   */
  protected normalizePercentageChange(
    changePct: number,
    maxPct: number
  ): number {
    return Math.min(Math.abs(changePct) / maxPct, 1.0);
  }
}
