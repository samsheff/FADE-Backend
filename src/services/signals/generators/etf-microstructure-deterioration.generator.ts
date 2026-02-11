import { SignalGeneratorBase } from './signal-generator.base.js';
import { SignalType } from '../../../types/edgar.types.js';
import {
  GeneratorContext,
  GeneratedSignal,
  VolatilityRegimeShiftEvidence,
  ImpactAsymmetryEvidence,
} from '../types/generator.types.js';
import { InstrumentRepository } from '../../../adapters/database/repositories/instrument.repository.js';
import { CandleRepository } from '../../../adapters/database/repositories/candle.repository.js';
import { getLogger } from '../../../utils/logger.js';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * Signal Generator for ETF Microstructure Deterioration Detection
 *
 * Early-warning market signals using candle-based proxies:
 * 1. Volatility regime shift (20-day vol > 1.5x 60-day baseline)
 * 2. Impact asymmetry (consecutive large red candles with high volume)
 *
 * Note: Spread regime shift skipped - OrderbookEvent has marketId, not instrumentId
 */
export class MicrostructureDeteriorationGenerator extends SignalGeneratorBase {
  readonly generatorName = 'ETF Microstructure Deterioration';
  readonly signalType = SignalType.ETF_MICROSTRUCTURE_VOL_REGIME_SHIFT;

  private logger = getLogger().child({ generator: this.generatorName });
  private instrumentRepo: InstrumentRepository;
  private candleRepo: CandleRepository;

  // Detection thresholds
  private readonly VOL_RATIO_THRESHOLD = 1.5; // 50% increase
  private readonly RED_CANDLE_THRESHOLD_PCT = 3.0; // 3% drop
  private readonly VOLUME_Z_THRESHOLD = 2.0;
  private readonly CONSECUTIVE_DAYS_THRESHOLD = 3;

  constructor(
    instrumentRepo: InstrumentRepository,
    candleRepo: CandleRepository
  ) {
    super();
    this.instrumentRepo = instrumentRepo;
    this.candleRepo = candleRepo;
  }

  async generate(context: GeneratorContext): Promise<GeneratedSignal[]> {
    const signals: GeneratedSignal[] = [];
    const stats = {
      processed: 0,
      skippedNoCandles: 0,
      errors: 0,
    };

    try {
      const etfs = await this.instrumentRepo.findByType('ETF');

      for (const etf of etfs) {
        if (!etf.isActive) continue;
        stats.processed++;

        try {
          // Signal 1: Volatility regime shift
          const volSignal = await this.detectVolatilityRegimeShift(etf.id, context);
          if (volSignal) signals.push(volSignal);

          // Signal 2: Impact asymmetry
          const impactSignal = await this.detectImpactAsymmetry(etf.id, context);
          if (impactSignal) signals.push(impactSignal);
        } catch (error) {
          stats.errors++;
          this.logger.debug({ instrumentId: etf.id, error }, 'Error processing ETF');
        }
      }

      this.logger.info({
        processed: stats.processed,
        signalsGenerated: signals.length,
        skippedNoCandles: stats.skippedNoCandles,
        errors: stats.errors,
      }, 'Microstructure deterioration generator run complete');
    } catch (error) {
      this.logger.error({ error }, 'Error in microstructure deterioration generator');
    }

    return signals;
  }

  /**
   * Signal 1: Detect volatility regime shift
   */
  private async detectVolatilityRegimeShift(
    instrumentId: string,
    context: GeneratorContext
  ): Promise<GeneratedSignal | null> {
    try {
      // Get 60 days of daily candles
      const endDate = context.currentTime;
      const startDate = new Date(endDate.getTime() - 60 * 24 * 60 * 60 * 1000);

      const candles = await this.candleRepo.findByInstrument({
        instrumentId,
        interval: '1d',
        from: startDate,
        to: endDate,
      });

      if (candles.length < 30) return null; // Need at least 30 days

      // Extract close prices
      const closePrices = candles.map((c) => Number(c.close));

      // Calculate recent 20-day volatility
      const recent20Prices = closePrices.slice(0, 20);
      const recentVol = this.calculateStdDev(recent20Prices);

      // Calculate baseline 60-day volatility
      const baselineVol = this.calculateStdDev(closePrices);

      if (baselineVol === 0) return null;

      const volRatio = recentVol / baselineVol;

      // Trigger if ratio > 1.5x
      if (volRatio < this.VOL_RATIO_THRESHOLD) return null;

      const evidence: VolatilityRegimeShiftEvidence = {
        type: 'VOLATILITY_REGIME_SHIFT',
        recentVolatility20Day: recentVol,
        baselineVolatility60Day: baselineVol,
        volatilityRatio: volRatio,
        asOfDate: endDate,
      };

      const score = 35 + (volRatio * 25);
      const confidence = 0.85;

      if (!this.meetsConfidenceThreshold(confidence)) return null;

      return {
        instrumentId,
        signalType: SignalType.ETF_MICROSTRUCTURE_VOL_REGIME_SHIFT,
        severity: this.calculateSeverity(score, confidence),
        score,
        confidence,
        reason: `Volatility regime shift: 20-day volatility is ${volRatio.toFixed(2)}x the 60-day baseline, signaling potential liquidity withdrawal`,
        evidenceFacts: [evidence],
        expiresAt: this.createEtfExpirationDate(context.currentTime),
      };
    } catch (error) {
      this.logger.debug({ instrumentId, error }, 'Error detecting volatility regime shift');
      return null;
    }
  }

  /**
   * Signal 2: Detect impact asymmetry (sell pressure)
   */
  private async detectImpactAsymmetry(
    instrumentId: string,
    context: GeneratorContext
  ): Promise<GeneratedSignal | null> {
    try {
      // Get 30 days of daily candles
      const endDate = context.currentTime;
      const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

      const candles = await this.candleRepo.findByInstrument({
        instrumentId,
        interval: '1d',
        from: startDate,
        to: endDate,
      });

      if (candles.length < 20) return null;

      // Calculate volume statistics
      const volumes = candles.map((c) => Number(c.volume));
      const avgVolume = this.calculateMean(volumes);
      const stdDevVolume = this.calculateStdDev(volumes);

      if (stdDevVolume === 0) return null;

      // Find red candles with >3% drop and high volume
      const redCandlesWithHighVolume: Array<{
        index: number;
        dropPct: number;
        volumeZ: number;
      }> = [];

      for (let i = 0; i < candles.length; i++) {
        const candle = candles[i];
        const open = Number(candle.open);
        const close = Number(candle.close);
        const volume = Number(candle.volume);

        if (open === 0) continue;

        const dropPct = ((close - open) / open) * 100;
        const volumeZ = (volume - avgVolume) / stdDevVolume;

        // Red candle with >3% drop and z-score > 2.0
        if (dropPct < -this.RED_CANDLE_THRESHOLD_PCT && volumeZ > this.VOLUME_Z_THRESHOLD) {
          redCandlesWithHighVolume.push({ index: i, dropPct, volumeZ });
        }
      }

      // Find consecutive sequences
      let maxConsecutive = 0;
      let currentConsecutive = 0;
      let consecutiveDrops: number[] = [];
      let consecutiveZScores: number[] = [];

      for (let i = 0; i < redCandlesWithHighVolume.length; i++) {
        const current = redCandlesWithHighVolume[i];
        const next = redCandlesWithHighVolume[i + 1];

        if (next && next.index === current.index + 1) {
          // Consecutive
          if (currentConsecutive === 0) {
            consecutiveDrops = [current.dropPct];
            consecutiveZScores = [current.volumeZ];
          }
          consecutiveDrops.push(next.dropPct);
          consecutiveZScores.push(next.volumeZ);
          currentConsecutive++;
        } else {
          // End of sequence
          if (currentConsecutive > 0) {
            maxConsecutive = Math.max(maxConsecutive, currentConsecutive + 1);
          }
          currentConsecutive = 0;
        }
      }

      // Trigger if 3+ consecutive days
      if (maxConsecutive < this.CONSECUTIVE_DAYS_THRESHOLD) return null;

      const avgDropPct = this.calculateMean(consecutiveDrops);
      const avgVolumeZ = this.calculateMean(consecutiveZScores);

      const evidence: ImpactAsymmetryEvidence = {
        type: 'IMPACT_ASYMMETRY',
        consecutiveDownsideDays: maxConsecutive,
        avgRedCandleDropPct: avgDropPct,
        avgVolumeZScore: avgVolumeZ,
        totalRedCandles: redCandlesWithHighVolume.length,
        asOfDate: endDate,
      };

      const score = 50 + (maxConsecutive * 10) + (avgVolumeZ * 5);
      const confidence = 0.75;

      if (!this.meetsConfidenceThreshold(confidence)) return null;

      return {
        instrumentId,
        signalType: SignalType.ETF_IMPACT_ASYMMETRY_WARNING,
        severity: this.calculateSeverity(score, confidence),
        score,
        confidence,
        reason: `${maxConsecutive} consecutive days with large drops (avg ${Math.abs(avgDropPct).toFixed(1)}%) on high volume (avg z-score ${avgVolumeZ.toFixed(1)}), indicating fragile liquidity`,
        evidenceFacts: [evidence],
        expiresAt: this.createEtfExpirationDate(context.currentTime),
      };
    } catch (error) {
      this.logger.debug({ instrumentId, error }, 'Error detecting impact asymmetry');
      return null;
    }
  }

  /**
   * Calculate standard deviation
   */
  private calculateStdDev(values: number[]): number {
    if (values.length === 0) return 0;

    const mean = this.calculateMean(values);
    const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
    const variance = this.calculateMean(squaredDiffs);
    return Math.sqrt(variance);
  }

  /**
   * Calculate mean
   */
  private calculateMean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  /**
   * Create expiration date for ETF signals (90 days)
   */
  private createEtfExpirationDate(baseTime: Date): Date {
    const expirationMs = baseTime.getTime() + 90 * 24 * 60 * 60 * 1000;
    return new Date(expirationMs);
  }
}
