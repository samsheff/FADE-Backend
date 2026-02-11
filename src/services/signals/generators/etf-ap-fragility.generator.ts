import { SignalGeneratorBase } from './signal-generator.base.js';
import { SignalType } from '../../../types/edgar.types.js';
import {
  GeneratorContext,
  GeneratedSignal,
  ApConcentrationEvidence,
  ApCountDeclineEvidence,
  OneWayFlowEvidence,
} from '../types/generator.types.js';
import { InstrumentRepository } from '../../../adapters/database/repositories/instrument.repository.js';
import { EtfMetricsRepository } from '../../../adapters/database/repositories/etf-metrics.repository.js';
import { getLogger } from '../../../utils/logger.js';

/**
 * Signal Generator for ETF Authorized Participant (AP) Fragility Detection
 *
 * Detects when AP structure shows stress:
 * 1. High AP concentration (Top-3 > 60% OR HHI > 2500)
 * 2. Declining AP count (monotonic decrease over 2+ filings)
 * 3. One-way flow burst (3+ consecutive periods of net creation OR redemption)
 */
export class APFragilityGenerator extends SignalGeneratorBase {
  readonly generatorName = 'ETF AP Fragility';
  readonly signalType = SignalType.ETF_AP_CONCENTRATION_HIGH;

  private logger = getLogger().child({ generator: this.generatorName });
  private instrumentRepo: InstrumentRepository;
  private etfMetricsRepo: EtfMetricsRepository;

  // Detection thresholds
  private readonly TOP_THREE_THRESHOLD = 60.0; // Top-3 AP share > 60%
  private readonly HHI_THRESHOLD = 2500; // Herfindahl-Hirschman Index > 2500
  private readonly ONE_WAY_FLOW_PERIODS = 3;

  constructor(
    instrumentRepo: InstrumentRepository,
    etfMetricsRepo: EtfMetricsRepository
  ) {
    super();
    this.instrumentRepo = instrumentRepo;
    this.etfMetricsRepo = etfMetricsRepo;
  }

  async generate(context: GeneratorContext): Promise<GeneratedSignal[]> {
    const signals: GeneratedSignal[] = [];

    try {
      // Get all ETF instruments
      const etfs = await this.instrumentRepo.findByType('ETF');
      this.logger.info({ count: etfs.length }, 'Processing ETFs for AP fragility');

      for (const etf of etfs) {
        if (!etf.isActive) continue;

        // Rule 1: Check for high AP concentration
        const concentrationSignal = await this.detectApConcentration(
          etf.id,
          context
        );
        if (concentrationSignal) {
          signals.push(concentrationSignal);
        }

        // Rule 2: Check for declining AP count
        const declineSignal = await this.detectApCountDecline(etf.id, context);
        if (declineSignal) {
          signals.push(declineSignal);
        }

        // Rule 3: Check for one-way flow burst
        const flowSignal = await this.detectOneWayFlowBurst(etf.id, context);
        if (flowSignal) {
          signals.push(flowSignal);
        }
      }

      this.logger.info(
        { signalsGenerated: signals.length },
        'Completed AP fragility detection'
      );
    } catch (error) {
      this.logger.error({ error }, 'Error generating AP fragility signals');
    }

    return signals;
  }

  /**
   * Detect high AP concentration (Rule 1)
   */
  private async detectApConcentration(
    instrumentId: string,
    context: GeneratorContext
  ): Promise<GeneratedSignal | null> {
    try {
      const latestMetrics = await this.etfMetricsRepo.findLatestByInstrument(
        instrumentId
      );

      if (!latestMetrics) return null;

      const topThreeShare = latestMetrics.topThreeApShare
        ? Number(latestMetrics.topThreeApShare)
        : null;
      const hhi = latestMetrics.hhi ? Number(latestMetrics.hhi) : null;
      const activeApCount = latestMetrics.activeApCount;

      // Check if concentration is high
      const isHighConcentration =
        (topThreeShare !== null && topThreeShare > this.TOP_THREE_THRESHOLD) ||
        (hhi !== null && hhi > this.HHI_THRESHOLD);

      if (!isHighConcentration) return null;

      const evidence: ApConcentrationEvidence = {
        type: 'AP_CONCENTRATION',
        topThreeApShare: topThreeShare || 0,
        hhi: hhi || 0,
        activeApCount: activeApCount || 0,
        filingId: latestMetrics.filingId || '',
        asOfDate: latestMetrics.asOfDate,
      };

      // Score based on concentration level
      let score = 50;
      if (topThreeShare && topThreeShare > 80) {
        score = 90;
      } else if (topThreeShare && topThreeShare > 70) {
        score = 75;
      } else if (hhi && hhi > 4000) {
        score = 85;
      } else if (hhi && hhi > 3000) {
        score = 70;
      }

      const confidence = 0.9; // High confidence if disclosed in filing

      return {
        instrumentId,
        signalType: SignalType.ETF_AP_CONCENTRATION_HIGH,
        severity: this.calculateSeverity(score, confidence),
        score,
        confidence,
        reason: `High AP concentration detected: ${topThreeShare ? `Top-3 share ${topThreeShare.toFixed(1)}%` : ''} ${hhi ? `HHI ${hhi.toFixed(0)}` : ''} (${activeApCount} total APs)`,
        evidenceFacts: [evidence],
        expiresAt: this.createEtfExpirationDate(context.currentTime),
      };
    } catch (error) {
      this.logger.error(
        { instrumentId, error },
        'Error detecting AP concentration'
      );
      return null;
    }
  }

  /**
   * Detect declining AP count (Rule 2)
   */
  private async detectApCountDecline(
    instrumentId: string,
    context: GeneratorContext
  ): Promise<GeneratedSignal | null> {
    try {
      const history = await this.etfMetricsRepo.findHistoricalByInstrument(
        instrumentId,
        5
      );

      if (history.length < 2) return null;

      // Check for monotonic decline
      const apCounts = history
        .filter((m) => m.activeApCount !== null)
        .map((m) => ({ count: m.activeApCount!, date: m.asOfDate }))
        .sort((a, b) => b.date.getTime() - a.date.getTime()); // Most recent first

      if (apCounts.length < 2) return null;

      // Check if declining
      let isMonotonicDecline = true;
      for (let i = 0; i < apCounts.length - 1; i++) {
        if (apCounts[i].count >= apCounts[i + 1].count) {
          isMonotonicDecline = false;
          break;
        }
      }

      if (!isMonotonicDecline) return null;

      const currentApCount = apCounts[0].count;
      const priorApCount = apCounts[apCounts.length - 1].count;
      const declineRate = ((priorApCount - currentApCount) / priorApCount) * 100;

      const evidence: ApCountDeclineEvidence = {
        type: 'AP_COUNT_DECLINE',
        currentApCount,
        priorApCount,
        declineRate,
        filingCount: apCounts.length,
      };

      const score = Math.min(declineRate * 5, 100);
      const confidence = apCounts.length >= 3 ? 0.95 : 0.75;

      if (!this.meetsConfidenceThreshold(confidence)) return null;

      return {
        instrumentId,
        signalType: SignalType.ETF_AP_COUNT_DECLINING,
        severity: this.calculateSeverity(score, confidence),
        score,
        confidence,
        reason: `AP count declining: ${priorApCount} → ${currentApCount} (${declineRate.toFixed(0)}% decline over ${apCounts.length} filings)`,
        evidenceFacts: [evidence],
        expiresAt: this.createEtfExpirationDate(context.currentTime),
      };
    } catch (error) {
      this.logger.error(
        { instrumentId, error },
        'Error detecting AP count decline'
      );
      return null;
    }
  }

  /**
   * Detect one-way creation/redemption flow burst (Rule 3)
   */
  private async detectOneWayFlowBurst(
    instrumentId: string,
    context: GeneratorContext
  ): Promise<GeneratedSignal | null> {
    try {
      const history = await this.etfMetricsRepo.findHistoricalByInstrument(
        instrumentId,
        10
      );

      if (history.length < this.ONE_WAY_FLOW_PERIODS) return null;

      // Check for consecutive creation-only or redemption-only periods
      const flowData = history
        .filter((m) => m.netFlowUnits !== null)
        .map((m) => ({
          netFlow: Number(m.netFlowUnits!),
          date: m.asOfDate,
        }))
        .sort((a, b) => b.date.getTime() - a.date.getTime()); // Most recent first

      if (flowData.length < this.ONE_WAY_FLOW_PERIODS) return null;

      // Check for consecutive periods of same-direction flow
      let consecutiveCreation = 0;
      let consecutiveRedemption = 0;
      let totalCreationFlow = 0;
      let totalRedemptionFlow = 0;

      for (const flow of flowData) {
        if (flow.netFlow > 0) {
          consecutiveCreation++;
          totalCreationFlow += flow.netFlow;
          consecutiveRedemption = 0;
        } else if (flow.netFlow < 0) {
          consecutiveRedemption++;
          totalRedemptionFlow += Math.abs(flow.netFlow);
          consecutiveCreation = 0;
        } else {
          break;
        }

        if (
          consecutiveCreation >= this.ONE_WAY_FLOW_PERIODS ||
          consecutiveRedemption >= this.ONE_WAY_FLOW_PERIODS
        ) {
          break;
        }
      }

      const isOneWayBurst =
        consecutiveCreation >= this.ONE_WAY_FLOW_PERIODS ||
        consecutiveRedemption >= this.ONE_WAY_FLOW_PERIODS;

      if (!isOneWayBurst) return null;

      const direction =
        consecutiveCreation >= this.ONE_WAY_FLOW_PERIODS
          ? 'CREATION'
          : 'REDEMPTION';
      const consecutivePeriods =
        direction === 'CREATION' ? consecutiveCreation : consecutiveRedemption;
      const totalFlow =
        direction === 'CREATION' ? totalCreationFlow : totalRedemptionFlow;

      const evidence: OneWayFlowEvidence = {
        type: 'ONE_WAY_FLOW',
        direction,
        totalFlowUnits: totalFlow,
        consecutivePeriods,
      };

      // Score based on magnitude and duration
      const score = Math.min(40 + consecutivePeriods * 10, 100);
      const confidence = 0.85;

      return {
        instrumentId,
        signalType: SignalType.ETF_CREATION_REDEMPTION_ONE_WAY_BURST,
        severity: this.calculateSeverity(score, confidence),
        score,
        confidence,
        reason: `One-way ${direction.toLowerCase()} flow burst: ${totalFlow.toFixed(0)} units over ${consecutivePeriods} consecutive periods`,
        evidenceFacts: [evidence],
        expiresAt: this.createEtfExpirationDate(context.currentTime),
      };
    } catch (error) {
      this.logger.error(
        { instrumentId, error },
        'Error detecting one-way flow burst'
      );
      return null;
    }
  }

  /**
   * Create expiration date for ETF signals (90 days instead of default 30)
   */
  private createEtfExpirationDate(baseTime: Date): Date {
    const expirationMs = baseTime.getTime() + 90 * 24 * 60 * 60 * 1000;
    return new Date(expirationMs);
  }
}
