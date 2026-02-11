import { SignalGeneratorBase } from './signal-generator.base.js';
import { SignalType } from '../../../types/edgar.types.js';
import {
  GeneratorContext,
  GeneratedSignal,
  PersistentDeviationEvidence,
  ExtremeDeviationEvidence,
} from '../types/generator.types.js';
import { InstrumentRepository } from '../../../adapters/database/repositories/instrument.repository.js';
import { EtfNavDataService } from '../../etf/etf-nav-data.service.js';
import { getLogger } from '../../../utils/logger.js';

/**
 * Signal Generator for ETF Arbitrage Breakdown Detection
 *
 * Detects when ETF arbitrage mechanism is under stress:
 * 1. Persistent premium/discount (7+ consecutive days > 2%)
 * 2. Extreme deviation (premium/discount > 2 std deviations from mean)
 */
export class ArbitrageBreakdownGenerator extends SignalGeneratorBase {
  readonly generatorName = 'ETF Arbitrage Breakdown';
  readonly signalType = SignalType.ETF_ARB_STRESS_PERSISTENT_DISCOUNT;

  private logger = getLogger().child({ generator: this.generatorName });
  private instrumentRepo: InstrumentRepository;
  private navDataService: EtfNavDataService;

  // Detection thresholds
  private readonly PREMIUM_DISCOUNT_THRESHOLD = 2.0; // 2% deviation
  private readonly CONSECUTIVE_DAYS_THRESHOLD = 7;
  private readonly Z_SCORE_THRESHOLD = 2.0;
  private readonly LOOKBACK_DAYS = 60;

  constructor(
    instrumentRepo: InstrumentRepository,
    navDataService: EtfNavDataService
  ) {
    super();
    this.instrumentRepo = instrumentRepo;
    this.navDataService = navDataService;
  }

  async generate(context: GeneratorContext): Promise<GeneratedSignal[]> {
    const signals: GeneratedSignal[] = [];

    try {
      // Get all ETF instruments
      const etfs = await this.instrumentRepo.findByType('ETF');
      this.logger.info({ count: etfs.length }, 'Processing ETFs for arbitrage breakdown');

      for (const etf of etfs) {
        if (!etf.isActive) continue;

        // Rule 1: Check for persistent premium/discount
        const persistentSignals = await this.detectPersistentDeviation(etf.id, context);
        signals.push(...persistentSignals);

        // Rule 2: Check for extreme z-score deviation
        const extremeSignal = await this.detectExtremeDeviation(etf.id, context);
        if (extremeSignal) {
          signals.push(extremeSignal);
        }
      }

      this.logger.info(
        { signalsGenerated: signals.length },
        'Completed arbitrage breakdown detection'
      );
    } catch (error) {
      this.logger.error({ error }, 'Error generating arbitrage breakdown signals');
    }

    return signals;
  }

  /**
   * Detect persistent premium or discount (Rule 1)
   */
  private async detectPersistentDeviation(
    instrumentId: string,
    context: GeneratorContext
  ): Promise<GeneratedSignal[]> {
    const signals: GeneratedSignal[] = [];

    try {
      // Check for persistent premium
      const premiumDays = await this.navDataService.getConsecutivePremiumDays(
        instrumentId,
        this.PREMIUM_DISCOUNT_THRESHOLD,
        'PREMIUM'
      );

      if (premiumDays >= this.CONSECUTIVE_DAYS_THRESHOLD) {
        const latestNav = await this.navDataService.getLatestNav(instrumentId);
        if (latestNav && latestNav.premium) {
          const premiumPct = Number(latestNav.premium);

          const evidence: PersistentDeviationEvidence = {
            type: 'PERSISTENT_DEVIATION',
            deviationPct: premiumPct,
            consecutiveDays: premiumDays,
            direction: 'PREMIUM',
          };

          const score = Math.min(Math.abs(premiumPct) * 10, 100);
          const confidence = 1.0; // High confidence if all days consistent

          signals.push({
            instrumentId,
            signalType: SignalType.ETF_ARB_STRESS_PERSISTENT_PREMIUM,
            severity: this.calculateSeverity(score, confidence),
            score,
            confidence,
            reason: `Persistent premium of ${premiumPct.toFixed(2)}% for ${premiumDays} consecutive days indicates arbitrage stress`,
            evidenceFacts: [evidence],
            expiresAt: this.createEtfExpirationDate(context.currentTime),
          });
        }
      }

      // Check for persistent discount
      const discountDays = await this.navDataService.getConsecutivePremiumDays(
        instrumentId,
        this.PREMIUM_DISCOUNT_THRESHOLD,
        'DISCOUNT'
      );

      if (discountDays >= this.CONSECUTIVE_DAYS_THRESHOLD) {
        const latestNav = await this.navDataService.getLatestNav(instrumentId);
        if (latestNav && latestNav.premium) {
          const premiumPct = Number(latestNav.premium);

          const evidence: PersistentDeviationEvidence = {
            type: 'PERSISTENT_DEVIATION',
            deviationPct: premiumPct,
            consecutiveDays: discountDays,
            direction: 'DISCOUNT',
          };

          const score = Math.min(Math.abs(premiumPct) * 10, 100);
          const confidence = 1.0;

          signals.push({
            instrumentId,
            signalType: SignalType.ETF_ARB_STRESS_PERSISTENT_DISCOUNT,
            severity: this.calculateSeverity(score, confidence),
            score,
            confidence,
            reason: `Persistent discount of ${premiumPct.toFixed(2)}% for ${discountDays} consecutive days indicates arbitrage stress`,
            evidenceFacts: [evidence],
            expiresAt: this.createEtfExpirationDate(context.currentTime),
          });
        }
      }
    } catch (error) {
      this.logger.error(
        { instrumentId, error },
        'Error detecting persistent deviation'
      );
    }

    return signals;
  }

  /**
   * Detect extreme z-score deviation (Rule 2)
   */
  private async detectExtremeDeviation(
    instrumentId: string,
    context: GeneratorContext
  ): Promise<GeneratedSignal | null> {
    try {
      const result = await this.navDataService.isExtremeDeviation(
        instrumentId,
        this.LOOKBACK_DAYS
      );

      if (!result || !result.isExtreme) return null;

      const { zScore, stats } = result;

      const evidence: ExtremeDeviationEvidence = {
        type: 'EXTREME_DEVIATION',
        deviationPct: stats.current,
        zScore: zScore,
        mean60Day: stats.mean,
        stdDev60Day: stats.stdDev,
      };

      const score = Math.min(Math.abs(zScore) * 30, 100);
      const confidence = Math.min(Math.abs(zScore) / 3, 1.0);

      if (!this.meetsConfidenceThreshold(confidence)) return null;

      return {
        instrumentId,
        signalType: SignalType.ETF_ARB_STRESS_EXTREME_DEVIATION,
        severity: this.calculateSeverity(score, confidence),
        score,
        confidence,
        reason: `Extreme premium/discount deviation of ${stats.current.toFixed(2)}% (${zScore.toFixed(2)} std deviations from ${this.LOOKBACK_DAYS}-day mean)`,
        evidenceFacts: [evidence],
        expiresAt: this.createEtfExpirationDate(context.currentTime),
      };
    } catch (error) {
      this.logger.error(
        { instrumentId, error },
        'Error detecting extreme deviation'
      );
      return null;
    }
  }

  /**
   * Create expiration date for ETF signals (90 days instead of default 30)
   * ETF signals align with quarterly N-PORT filing cycle
   */
  private createEtfExpirationDate(baseTime: Date): Date {
    const expirationMs = baseTime.getTime() + 90 * 24 * 60 * 60 * 1000;
    return new Date(expirationMs);
  }
}
