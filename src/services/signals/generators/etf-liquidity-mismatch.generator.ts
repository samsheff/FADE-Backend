import { SignalGeneratorBase } from './signal-generator.base.js';
import { SignalType, FilingType } from '../../../types/edgar.types.js';
import {
  GeneratorContext,
  GeneratedSignal,
  LiquidityMismatchEvidence,
  FlowShockEvidence,
  TrackingStressEvidence,
} from '../types/generator.types.js';
import { InstrumentRepository } from '../../../adapters/database/repositories/instrument.repository.js';
import { EtfMetricsRepository } from '../../../adapters/database/repositories/etf-metrics.repository.js';
import { EtfNavDataService } from '../../etf/etf-nav-data.service.js';
import { CandleRepository } from '../../../adapters/database/repositories/candle.repository.js';
import { FilingRepository } from '../../../adapters/database/repositories/filing.repository.js';
import { getLogger } from '../../../utils/logger.js';
import { Decimal } from '@prisma/client/runtime/library';
import { NPortHolding } from '../../../types/etf.types.js';
import { getPrismaClient } from '../../../adapters/database/client.js';

/**
 * Signal Generator for ETF Liquidity Mismatch Detection
 *
 * Detects structural fragility when ETF liquidity diverges from underlying assets:
 * 1. Elevated liquidity mismatch (illiquid holdings + premium/discount stress OR volume spike)
 * 2. Flow shock with illiquid risk (outflows + discount widening + illiquid holdings)
 * 3. NAV tracking stress (deviation + volume increase + volatility increase)
 */
export class LiquidityMismatchGenerator extends SignalGeneratorBase {
  readonly generatorName = 'ETF Liquidity Mismatch';
  readonly signalType = SignalType.ETF_LIQUIDITY_MISMATCH_ELEVATED;

  private logger = getLogger().child({ generator: this.generatorName });
  private instrumentRepo: InstrumentRepository;
  private etfMetricsRepo: EtfMetricsRepository;
  private navDataService: EtfNavDataService;
  private candleRepo: CandleRepository;
  private filingRepo: FilingRepository;
  private prisma = getPrismaClient();

  // Detection thresholds
  private readonly ILLIQUID_THRESHOLD_PCT = 30.0;
  private readonly PREMIUM_DISCOUNT_THRESHOLD = 3.0;
  private readonly VOLUME_Z_THRESHOLD = 2.5;
  private readonly FLOW_SHOCK_THRESHOLD = -10.0; // -10% net redemption
  private readonly DISCOUNT_WIDENING_THRESHOLD = -2.0;
  private readonly NAV_DEVIATION_THRESHOLD = 2.0;
  private readonly VOLUME_RATIO_THRESHOLD = 1.5;
  private readonly VOLATILITY_RATIO_THRESHOLD = 1.8;

  constructor(
    instrumentRepo: InstrumentRepository,
    etfMetricsRepo: EtfMetricsRepository,
    navDataService: EtfNavDataService,
    candleRepo: CandleRepository,
    filingRepo: FilingRepository
  ) {
    super();
    this.instrumentRepo = instrumentRepo;
    this.etfMetricsRepo = etfMetricsRepo;
    this.navDataService = navDataService;
    this.candleRepo = candleRepo;
    this.filingRepo = filingRepo;
  }

  async generate(context: GeneratorContext): Promise<GeneratedSignal[]> {
    const signals: GeneratedSignal[] = [];
    const stats = {
      processed: 0,
      skippedNoHoldings: 0,
      skippedNoNav: 0,
      skippedNoCandles: 0,
      errors: 0,
    };

    try {
      const etfs = await this.instrumentRepo.findByType('ETF');

      for (const etf of etfs) {
        if (!etf.isActive) continue;
        stats.processed++;

        try {
          // Signal 1: Liquidity mismatch elevated
          const mismatchSignal = await this.detectLiquidityMismatch(etf.id, context);
          if (mismatchSignal) signals.push(mismatchSignal);

          // Signal 2: Flow shock with illiquid risk
          const flowSignal = await this.detectFlowShock(etf.id, context);
          if (flowSignal) signals.push(flowSignal);

          // Signal 3: NAV tracking stress
          const trackingSignal = await this.detectTrackingStress(etf.id, context);
          if (trackingSignal) signals.push(trackingSignal);
        } catch (error) {
          stats.errors++;
          this.logger.debug({ instrumentId: etf.id, error }, 'Error processing ETF');
        }
      }

      this.logger.info({
        processed: stats.processed,
        signalsGenerated: signals.length,
        skippedNoHoldings: stats.skippedNoHoldings,
        skippedNoNav: stats.skippedNoNav,
        skippedNoCandles: stats.skippedNoCandles,
        errors: stats.errors,
      }, 'Liquidity mismatch generator run complete');
    } catch (error) {
      this.logger.error({ error }, 'Error in liquidity mismatch generator');
    }

    return signals;
  }

  /**
   * Signal 1: Detect elevated liquidity mismatch
   */
  private async detectLiquidityMismatch(
    instrumentId: string,
    context: GeneratorContext
  ): Promise<GeneratedSignal | null> {
    try {
      // Get illiquid holdings percentage from latest N-PORT
      const illiquidPct = await this.calculateIlliquidHoldingsPct(instrumentId);

      // Get latest NAV data for premium/discount
      const latestNav = await this.navDataService.getLatestNav(instrumentId);
      if (!latestNav || !latestNav.premium) return null;

      const premiumPct = Number(latestNav.premium);

      // Get volume z-score from candles
      const { volumeZ, volumeSpike } = await this.calculateVolumeZScore(
        instrumentId,
        context.currentTime
      );

      // Trigger: illiquid > 30% AND (premium > 3% OR volume z > 2.5)
      const hasIlliquidRisk = illiquidPct && illiquidPct > this.ILLIQUID_THRESHOLD_PCT;
      const hasPremiumStress = Math.abs(premiumPct) > this.PREMIUM_DISCOUNT_THRESHOLD;
      const hasVolumeSpike = volumeSpike;

      if (!hasIlliquidRisk || (!hasPremiumStress && !hasVolumeSpike)) return null;

      const evidence: LiquidityMismatchEvidence = {
        type: 'LIQUIDITY_MISMATCH',
        illiquidHoldingsPct: illiquidPct || 0,
        premiumDiscountPct: premiumPct,
        volumeZScore: volumeZ,
        volumeSpike,
        asOfDate: context.currentTime,
        filingId: null, // Could track source filing if needed
      };

      const score = 40 +
        ((illiquidPct || 0) / 100 * 30) +
        (Math.abs(premiumPct) * 5) +
        (volumeZ * 10);
      const confidence = illiquidPct ? 0.7 : 0.5; // Lower confidence if no holdings data

      if (!this.meetsConfidenceThreshold(confidence)) return null;

      return {
        instrumentId,
        signalType: SignalType.ETF_LIQUIDITY_MISMATCH_ELEVATED,
        severity: this.calculateSeverity(score, confidence),
        score,
        confidence,
        reason: `Liquidity mismatch: ${illiquidPct?.toFixed(1) || 'unknown'}% illiquid holdings with ${Math.abs(premiumPct).toFixed(2)}% premium/discount${volumeSpike ? ' and volume spike' : ''}`,
        evidenceFacts: [evidence],
        expiresAt: this.createEtfExpirationDate(context.currentTime),
      };
    } catch (error) {
      this.logger.debug({ instrumentId, error }, 'Error detecting liquidity mismatch');
      return null;
    }
  }

  /**
   * Signal 2: Detect flow shock with illiquid risk
   */
  private async detectFlowShock(
    instrumentId: string,
    context: GeneratorContext
  ): Promise<GeneratedSignal | null> {
    try {
      // Get historical metrics for flow analysis (last 30 days)
      const metrics = await this.etfMetricsRepo.findHistoricalByInstrument(instrumentId, 30);
      if (metrics.length < 5) return null;

      // Calculate net flow rate from recent data
      const recentFlows = metrics
        .filter((m) => m.netFlowUnits)
        .map((m) => Number(m.netFlowUnits));

      if (recentFlows.length === 0) return null;

      const totalFlow = recentFlows.reduce((sum, f) => sum + f, 0);
      const avgFlow = totalFlow / recentFlows.length;

      // Calculate flow rate as percentage (approximate)
      const flowRate = avgFlow; // Simplified - ideally normalize by AUM

      // Count consecutive outflow days
      let consecutiveOutflows = 0;
      for (const flow of recentFlows) {
        if (flow < 0) {
          consecutiveOutflows++;
        } else {
          break;
        }
      }

      // Get current discount
      const latestNav = await this.navDataService.getLatestNav(instrumentId);
      if (!latestNav || !latestNav.premium) return null;

      const discountPct = Number(latestNav.premium);

      // Check discount widening (compare to 7-day average)
      const recentPremiums = metrics
        .slice(0, 7)
        .filter((m) => m.premium)
        .map((m) => Number(m.premium));

      const avgDiscount = recentPremiums.length > 0
        ? recentPremiums.reduce((sum, p) => sum + p, 0) / recentPremiums.length
        : discountPct;

      const discountWidening = discountPct - avgDiscount;

      // Get illiquid exposure (optional)
      const illiquidPct = await this.calculateIlliquidHoldingsPct(instrumentId);

      // Trigger: flow rate < -10% AND discount widening < -2%
      if (flowRate > this.FLOW_SHOCK_THRESHOLD) return null;
      if (discountWidening > this.DISCOUNT_WIDENING_THRESHOLD) return null;

      const evidence: FlowShockEvidence = {
        type: 'FLOW_SHOCK',
        netFlowRate: flowRate,
        discountPct,
        discountWidening,
        consecutiveOutflowDays: consecutiveOutflows,
        illiquidExposurePct: illiquidPct,
        asOfDate: context.currentTime,
      };

      const score = 50 + (Math.abs(flowRate) * 3) + (Math.abs(discountWidening) * 5);
      const confidence = illiquidPct ? 0.8 : 0.6;

      if (!this.meetsConfidenceThreshold(confidence)) return null;

      return {
        instrumentId,
        signalType: SignalType.ETF_FLOW_SHOCK_ILLIQUID_RISK,
        severity: this.calculateSeverity(score, confidence),
        score,
        confidence,
        reason: `Flow shock: ${Math.abs(flowRate).toFixed(1)}% outflows with ${Math.abs(discountWidening).toFixed(2)}% discount widening over ${consecutiveOutflows} days`,
        evidenceFacts: [evidence],
        expiresAt: this.createEtfExpirationDate(context.currentTime),
      };
    } catch (error) {
      this.logger.debug({ instrumentId, error }, 'Error detecting flow shock');
      return null;
    }
  }

  /**
   * Signal 3: Detect NAV tracking stress
   */
  private async detectTrackingStress(
    instrumentId: string,
    context: GeneratorContext
  ): Promise<GeneratedSignal | null> {
    try {
      // Get NAV deviation
      const stats = await this.navDataService.getPremiumDiscountStats(instrumentId, 60);
      if (!stats) return null;

      const navDeviation = Math.abs(stats.current);

      // Get volume ratio (5-day avg vs 25-day avg)
      const endDate = context.currentTime;
      const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

      const candles = await this.candleRepo.findByInstrument({
        instrumentId,
        interval: '1d',
        from: startDate,
        to: endDate,
      });
      if (candles.length < 25) return null;

      const recentVolumes = candles.slice(0, 5).map((c) => Number(c.volume));
      const baselineVolumes = candles.slice(5, 30).map((c) => Number(c.volume));

      const recentAvgVolume = this.calculateMean(recentVolumes);
      const baselineAvgVolume = this.calculateMean(baselineVolumes);

      if (baselineAvgVolume === 0) return null;

      const volumeRatio = recentAvgVolume / baselineAvgVolume;

      // Get volatility ratio (20-day vs 60-day)
      const closePrices = candles.map((c) => Number(c.close));
      const recent20Vol = this.calculateStdDev(closePrices.slice(0, 20));
      const baseline60Vol = this.calculateStdDev(closePrices);

      if (baseline60Vol === 0) return null;

      const volRatio = recent20Vol / baseline60Vol;

      // Trigger: deviation > 2% AND volume ratio > 1.5x AND vol ratio > 1.8x
      if (navDeviation < this.NAV_DEVIATION_THRESHOLD) return null;
      if (volumeRatio < this.VOLUME_RATIO_THRESHOLD) return null;
      if (volRatio < this.VOLATILITY_RATIO_THRESHOLD) return null;

      const evidence: TrackingStressEvidence = {
        type: 'TRACKING_STRESS',
        navDeviationPct: navDeviation,
        volumeIncreaseRatio: volumeRatio,
        volatilityIncreaseRatio: volRatio,
        recentVolumeAvg: recentAvgVolume,
        baselineVolumeAvg: baselineAvgVolume,
        asOfDate: context.currentTime,
      };

      const score = 30 + (navDeviation * 10) + (volumeRatio * 10) + (volRatio * 10);
      const confidence = 0.75;

      if (!this.meetsConfidenceThreshold(confidence)) return null;

      return {
        instrumentId,
        signalType: SignalType.ETF_TRACKING_STRESS,
        severity: this.calculateSeverity(score, confidence),
        score,
        confidence,
        reason: `Tracking stress: ${navDeviation.toFixed(2)}% NAV deviation with ${volumeRatio.toFixed(1)}x volume increase and ${volRatio.toFixed(1)}x volatility increase`,
        evidenceFacts: [evidence],
        expiresAt: this.createEtfExpirationDate(context.currentTime),
      };
    } catch (error) {
      this.logger.debug({ instrumentId, error }, 'Error detecting tracking stress');
      return null;
    }
  }

  /**
   * Calculate illiquid holdings percentage from latest N-PORT filing
   */
  private async calculateIlliquidHoldingsPct(instrumentId: string): Promise<number | null> {
    try {
      // Get CIK for this instrument
      const cikIdentifier = await this.prisma.instrumentIdentifier.findFirst({
        where: { instrumentId, type: 'CIK' },
      });
      if (!cikIdentifier) return null;

      // Get latest N-PORT filing
      const result = await this.filingRepo.findByCik(cikIdentifier.value, {
        filingType: FilingType.FORM_N_PORT,
        limit: 1,
      });

      const filings = result.filings;
      if (filings.length === 0) return null;

      const filing = filings[0];
      const content = await this.filingRepo.findContentByFilingId(filing.id);
      if (!content) return null;

      // Parse holdings from N-PORT XML
      const holdings = this.parseNPortHoldings(content.fullText);
      if (holdings.length === 0) return null;

      // Calculate total portfolio value
      const totalValue = holdings.reduce((sum, h) => sum + Number(h.value), 0);
      if (totalValue === 0) return null;

      // Define illiquid as: holdings with value < $1M OR bottom 20% by value
      const sortedByValue = [...holdings].sort((a, b) => Number(b.value) - Number(a.value));
      const bottom20Threshold = sortedByValue[Math.floor(sortedByValue.length * 0.8)];
      const bottom20Value = bottom20Threshold ? Number(bottom20Threshold.value) : 0;

      let illiquidValue = 0;
      for (const holding of holdings) {
        const value = Number(holding.value);
        if (value < 1_000_000 || value <= bottom20Value) {
          illiquidValue += value;
        }
      }

      return (illiquidValue / totalValue) * 100;
    } catch (error) {
      this.logger.debug({ instrumentId, error }, 'Error calculating illiquid holdings');
      return null;
    }
  }

  /**
   * Calculate volume z-score from recent candles
   */
  private async calculateVolumeZScore(
    instrumentId: string,
    asOfDate: Date
  ): Promise<{ volumeZ: number; volumeSpike: boolean }> {
    try {
      const endDate = asOfDate;
      const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

      const candles = await this.candleRepo.findByInstrument({
        instrumentId,
        interval: '1d',
        from: startDate,
        to: endDate,
      });
      if (candles.length < 10) return { volumeZ: 0, volumeSpike: false };

      const volumes = candles.map((c) => Number(c.volume));
      const avgVolume = this.calculateMean(volumes);
      const stdDevVolume = this.calculateStdDev(volumes);

      if (stdDevVolume === 0) return { volumeZ: 0, volumeSpike: false };

      // Use most recent candle for z-score
      const recentVolume = volumes[0];
      const volumeZ = (recentVolume - avgVolume) / stdDevVolume;

      return {
        volumeZ,
        volumeSpike: volumeZ > this.VOLUME_Z_THRESHOLD,
      };
    } catch (error) {
      return { volumeZ: 0, volumeSpike: false };
    }
  }

  /**
   * Parse N-PORT holdings from XML (simplified)
   */
  private parseNPortHoldings(fullText: string): NPortHolding[] {
    const holdings: NPortHolding[] = [];

    // Simple XML parsing - look for invstOrSec elements
    const holdingPattern = /<invstOrSec>[\s\S]*?<\/invstOrSec>/gi;
    const holdingMatches = fullText.match(holdingPattern);

    if (!holdingMatches) return holdings;

    for (const holdingXml of holdingMatches.slice(0, 100)) {
      const holding = this.parseHoldingXml(holdingXml);
      if (holding) {
        holdings.push(holding);
      }
    }

    return holdings;
  }

  /**
   * Parse a single holding XML element
   */
  private parseHoldingXml(xml: string): NPortHolding | null {
    try {
      const name = this.extractXmlTag(xml, 'name') || 'Unknown';
      const cusip = this.extractXmlTag(xml, 'cusip');
      const shares = this.extractXmlTag(xml, 'balance');
      const value = this.extractXmlTag(xml, 'valUSD');

      if (value) {
        return {
          name,
          cusip: cusip || undefined,
          shares: shares ? new Decimal(shares) : new Decimal(0),
          price: new Decimal(0), // Not extracting price for simplicity
          value: new Decimal(value),
        };
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract XML tag value
   */
  private extractXmlTag(xml: string, tagName: string): string | null {
    const pattern = new RegExp(`<${tagName}>([^<]+)<\/${tagName}>`, 'i');
    const match = xml.match(pattern);
    return match ? match[1].trim() : null;
  }

  /**
   * Calculate mean
   */
  private calculateMean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
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
   * Create expiration date for ETF signals (90 days)
   */
  private createEtfExpirationDate(baseTime: Date): Date {
    const expirationMs = baseTime.getTime() + 90 * 24 * 60 * 60 * 1000;
    return new Date(expirationMs);
  }
}
