import { FilingRepository } from '../../adapters/database/repositories/filing.repository.js';
import { InstrumentRepository } from '../../adapters/database/repositories/instrument.repository.js';
import { SignalRepository } from '../../adapters/database/repositories/signal.repository.js';
import { getEnvironment } from '../../config/environment.js';
import { getLogger } from '../../utils/logger.js';
import { SignalType, SignalSeverity, FactType } from '../../types/edgar.types.js';

/**
 * Signal Computer Service
 * Computes risk signals from extracted filing facts
 */
export class SignalComputerService {
  private filingRepo: FilingRepository;
  private instrumentRepo: InstrumentRepository;
  private signalRepo: SignalRepository;
  private logger;

  constructor() {
    this.filingRepo = new FilingRepository();
    this.instrumentRepo = new InstrumentRepository();
    this.signalRepo = new SignalRepository();
    this.logger = getLogger();
  }

  /**
   * Compute signals for all instruments with enriched filings
   * @returns Number of signals computed
   */
  async computeSignals(): Promise<number> {
    this.logger.info('Computing signals from filing facts');

    try {
      // Get all enriched filings
      const enrichedFilings = await this.filingRepo.findMany({
        status: 'ENRICHED',
        limit: 100,
      });

      if (enrichedFilings.filings.length === 0) {
        this.logger.debug('No enriched filings to compute signals from');
        return 0;
      }

      // Group by CIK
      const ciks = [...new Set(enrichedFilings.filings.map((f) => f.cik))];

      let signalCount = 0;

      for (const cik of ciks) {
        const instrument = await this.instrumentRepo.findByCik(cik);

        if (!instrument) {
          this.logger.warn({ cik }, 'No instrument found for CIK');
          continue;
        }

        // Compute all signal types for this instrument
        const signals = await Promise.all([
          this.computeDilutionRisk(instrument.id, cik),
          this.computeToxicFinancingRisk(instrument.id, cik),
          this.computeDistressRisk(instrument.id, cik),
        ]);

        // Filter out null signals and upsert
        for (const signal of signals.filter(Boolean)) {
          if (signal) {
            await this.signalRepo.upsertSignal(signal);
            signalCount++;
          }
        }
      }

      this.logger.info({ signalCount }, 'Computed signals');

      return signalCount;
    } catch (error) {
      this.logger.error({ error }, 'Failed to compute signals');
      throw error;
    }
  }

  /**
   * Compute DILUTION_RISK signal
   * Triggered by: Large shelf registrations relative to market cap
   */
  private async computeDilutionRisk(
    instrumentId: string,
    cik: string,
  ): Promise<{
    instrumentId: string;
    signalType: SignalType;
    severity: SignalSeverity;
    score: number;
    reason: string;
    evidenceFacts: string[];
    sourceFiling?: string;
  } | null> {
    const env = getEnvironment();
    const threshold = env.SIGNAL_DILUTION_SHELF_THRESHOLD_PCT;

    // Get ATM + Shelf facts for this CIK
    const facts = await this.filingRepo.findFactsByCik(cik, [
      FactType.ATM_PROGRAM,
      FactType.SHELF_REGISTRATION,
    ]);

    if (facts.length === 0) {
      return null;
    }

    // Calculate total shelf capacity
    let shelfCapacity = 0;
    const factIds: string[] = [];

    for (const fact of facts) {
      if (fact.data.amountMillions) {
        shelfCapacity += fact.data.amountMillions as number;
      }
      factIds.push(fact.id);
    }

    if (shelfCapacity === 0) {
      return null;
    }

    // Get instrument to check market cap (price-based estimate)
    const instrument = await this.instrumentRepo.findById(instrumentId);

    if (!instrument || !instrument.lastPrice) {
      // Can't compute without price data; assume moderate dilution risk
      const score = Math.min(shelfCapacity / 10, 100); // Heuristic: $100M shelf = score 10

      return {
        instrumentId,
        signalType: SignalType.DILUTION_RISK,
        severity: score > 50 ? SignalSeverity.HIGH : SignalSeverity.MEDIUM,
        score,
        reason: `Shelf capacity of $${shelfCapacity.toFixed(1)}M detected. Unable to compute dilution percentage without market cap data.`,
        evidenceFacts: factIds,
      };
    }

    // Rough market cap estimate (would need shares outstanding)
    // For now, use shelf amount alone as score
    const score = Math.min(shelfCapacity / 10, 100);

    if (score > threshold) {
      return {
        instrumentId,
        signalType: SignalType.DILUTION_RISK,
        severity: score > 50 ? SignalSeverity.CRITICAL : SignalSeverity.HIGH,
        score,
        reason: `Shelf capacity of $${shelfCapacity.toFixed(1)}M. Potential for significant dilution.`,
        evidenceFacts: factIds,
      };
    }

    return null;
  }

  /**
   * Compute TOXIC_FINANCING_RISK signal
   * Triggered by: Convertible debt + low stock price + recent reverse split
   */
  private async computeToxicFinancingRisk(
    instrumentId: string,
    cik: string,
  ): Promise<{
    instrumentId: string;
    signalType: SignalType;
    severity: SignalSeverity;
    score: number;
    reason: string;
    evidenceFacts: string[];
    sourceFiling?: string;
  } | null> {
    const env = getEnvironment();
    const priceThreshold = env.SIGNAL_TOXIC_PRICE_THRESHOLD;

    // Get relevant facts
    const facts = await this.filingRepo.findFactsByCik(cik, [
      FactType.CONVERTIBLE_DEBT,
      FactType.REVERSE_SPLIT,
    ]);

    const hasConvertibles = facts.some((f) => f.factType === FactType.CONVERTIBLE_DEBT);
    const hasReverseSplit = facts.some((f) => f.factType === FactType.REVERSE_SPLIT);

    if (!hasConvertibles) {
      return null; // Need convertibles for toxic financing signal
    }

    const instrument = await this.instrumentRepo.findById(instrumentId);
    const lowPrice =
      instrument?.lastPrice && parseFloat(instrument.lastPrice) < priceThreshold;

    // Toxic financing = convertibles + (low price OR reverse split)
    if (lowPrice || hasReverseSplit) {
      const indicators: string[] = [];
      if (lowPrice) indicators.push(`stock price below $${priceThreshold}`);
      if (hasReverseSplit) indicators.push('recent reverse split');

      return {
        instrumentId,
        signalType: SignalType.TOXIC_FINANCING_RISK,
        severity: SignalSeverity.CRITICAL,
        score: 90,
        reason: `Convertible debt detected with death spiral indicators: ${indicators.join(', ')}. High risk of continued dilution.`,
        evidenceFacts: facts.map((f) => f.id),
      };
    }

    // Convertibles alone = lower severity
    if (hasConvertibles) {
      return {
        instrumentId,
        signalType: SignalType.TOXIC_FINANCING_RISK,
        severity: SignalSeverity.MEDIUM,
        score: 50,
        reason: 'Convertible debt detected. Monitor for potential dilution if stock price declines.',
        evidenceFacts: facts.filter((f) => f.factType === FactType.CONVERTIBLE_DEBT).map((f) => f.id),
      };
    }

    return null;
  }

  /**
   * Compute DISTRESS_RISK signal
   * Triggered by: Going concern warnings, liquidity stress, covenant breaches
   */
  private async computeDistressRisk(
    instrumentId: string,
    cik: string,
  ): Promise<{
    instrumentId: string;
    signalType: SignalType;
    severity: SignalSeverity;
    score: number;
    reason: string;
    evidenceFacts: string[];
    sourceFiling?: string;
  } | null> {
    // Get distress-related facts
    const facts = await this.filingRepo.findFactsByCik(cik, [
      FactType.GOING_CONCERN,
      FactType.LIQUIDITY_STRESS,
      FactType.COVENANT_BREACH,
      FactType.DIRECTOR_RESIGNATION,
      FactType.RESTATEMENT,
    ]);

    if (facts.length === 0) {
      return null;
    }

    // Score based on severity of facts
    let score = 0;
    const indicators: string[] = [];

    for (const fact of facts) {
      switch (fact.factType) {
        case FactType.GOING_CONCERN:
          score += 40;
          indicators.push('going concern warning');
          break;
        case FactType.LIQUIDITY_STRESS:
          score += 30;
          indicators.push('liquidity stress');
          break;
        case FactType.COVENANT_BREACH:
          score += 25;
          indicators.push('covenant breach');
          break;
        case FactType.DIRECTOR_RESIGNATION:
          score += 15;
          indicators.push('director resignation');
          break;
        case FactType.RESTATEMENT:
          score += 20;
          indicators.push('financial restatement');
          break;
      }
    }

    score = Math.min(score, 100);

    // Determine severity
    let severity: SignalSeverity;
    if (score >= 70) {
      severity = SignalSeverity.CRITICAL;
    } else if (score >= 50) {
      severity = SignalSeverity.HIGH;
    } else if (score >= 30) {
      severity = SignalSeverity.MEDIUM;
    } else {
      severity = SignalSeverity.LOW;
    }

    return {
      instrumentId,
      signalType: SignalType.DISTRESS_RISK,
      severity,
      score,
      reason: `Company showing signs of financial distress: ${indicators.join(', ')}.`,
      evidenceFacts: facts.map((f) => f.id),
    };
  }
}
