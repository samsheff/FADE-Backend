import { SignalGeneratorBase } from './signal-generator.base.js';
import { SignalType, FilingType } from '../../../types/edgar.types.js';
import {
  GeneratorContext,
  GeneratedSignal,
  RepeatedDisclosureEvidence,
  StrategyDriftEvidence,
  BasketPolicyChangeEvidence,
} from '../types/generator.types.js';
import { InstrumentRepository } from '../../../adapters/database/repositories/instrument.repository.js';
import { FilingRepository } from '../../../adapters/database/repositories/filing.repository.js';
import { getLogger } from '../../../utils/logger.js';
import { distance } from 'fastest-levenshtein';
import { getPrismaClient } from '../../../adapters/database/client.js';

/**
 * Signal Generator for ETF Disclosure Drift Detection
 *
 * Filing-driven signals that detect:
 * 1. Repeated premium/discount disclosure episodes
 * 2. Strategy drift (objective/index changes)
 * 3. Basket policy changes
 */
export class DisclosureDriftGenerator extends SignalGeneratorBase {
  readonly generatorName = 'ETF Disclosure Drift';
  readonly signalType = SignalType.ETF_DISCLOSURE_REPEATED_PREM_DISC_EPISODES;

  private logger = getLogger().child({ generator: this.generatorName });
  private instrumentRepo: InstrumentRepository;
  private filingRepo: FilingRepository;
  private prisma = getPrismaClient();

  // Keywords for premium/discount detection
  private readonly PREMIUM_DISCOUNT_KEYWORDS = [
    'sustained deviation',
    'premium to NAV',
    'discount to NAV',
    'trading at a premium',
    'trading at a discount',
    'persistent premium',
    'persistent discount',
    'widening discount',
    'widening premium',
  ];

  // Keywords for basket policy changes
  private readonly BASKET_POLICY_KEYWORDS = [
    'creation basket',
    'redemption basket',
    'basket composition',
    'custom basket',
    'representative basket',
    'in-kind creation',
    'cash creation',
    'basket construction policy',
  ];

  constructor(
    instrumentRepo: InstrumentRepository,
    filingRepo: FilingRepository
  ) {
    super();
    this.instrumentRepo = instrumentRepo;
    this.filingRepo = filingRepo;
  }

  async generate(context: GeneratorContext): Promise<GeneratedSignal[]> {
    const signals: GeneratedSignal[] = [];
    const stats = {
      processed: 0,
      skippedNoFilings: 0,
      errors: 0,
    };

    try {
      const etfs = await this.instrumentRepo.findByType('ETF');

      for (const etf of etfs) {
        if (!etf.isActive) continue;
        stats.processed++;

        try {
          // Signal 1: Repeated premium/discount episodes
          const repeatedSignal = await this.detectRepeatedDisclosure(etf.id, context);
          if (repeatedSignal) signals.push(repeatedSignal);

          // Signal 2: Strategy drift
          const driftSignal = await this.detectStrategyDrift(etf.id, context);
          if (driftSignal) signals.push(driftSignal);

          // Signal 3: Basket policy changes
          const basketSignal = await this.detectBasketPolicyChange(etf.id, context);
          if (basketSignal) signals.push(basketSignal);
        } catch (error) {
          stats.errors++;
          this.logger.debug({ instrumentId: etf.id, error }, 'Error processing ETF');
        }
      }

      this.logger.info({
        processed: stats.processed,
        signalsGenerated: signals.length,
        skippedNoFilings: stats.skippedNoFilings,
        errors: stats.errors,
      }, 'Disclosure drift generator run complete');
    } catch (error) {
      this.logger.error({ error }, 'Error in disclosure drift generator');
    }

    return signals;
  }

  /**
   * Signal 1: Detect repeated premium/discount disclosure episodes
   */
  private async detectRepeatedDisclosure(
    instrumentId: string,
    context: GeneratorContext
  ): Promise<GeneratedSignal | null> {
    try {
      // Get CIK for this instrument
      const cikIdentifier = await this.prisma.instrumentIdentifier.findFirst({
        where: { instrumentId, type: 'CIK' },
      });
      if (!cikIdentifier) return null;

      // Get last 4 N-CEN filings
      const result = await this.filingRepo.findByCik(cikIdentifier.value, {
        filingType: FilingType.FORM_N_CEN,
        limit: 4,
      });

      const filings = result.filings;
      if (filings.length < 3) return null;

      // Check each filing for premium/discount mentions
      let filingsMentioning = 0;
      let totalMentions = 0;
      const filingIds: string[] = [];

      for (const filing of filings) {
        const content = await this.filingRepo.findContentByFilingId(filing.id);
        if (!content) continue;

        const mentions = this.countKeywordMentions(
          content.fullText,
          this.PREMIUM_DISCOUNT_KEYWORDS
        );

        if (mentions > 0) {
          filingsMentioning++;
          totalMentions += mentions;
          filingIds.push(filing.id);
        }
      }

      // Trigger if 3+ filings mention premium/discount
      if (filingsMentioning < 3) return null;

      const evidence: RepeatedDisclosureEvidence = {
        type: 'REPEATED_DISCLOSURE',
        filingsMentioningPremDisc: filingsMentioning,
        totalMentions,
        filingIds,
        lookbackFilings: filings.length,
        keywords: this.PREMIUM_DISCOUNT_KEYWORDS,
      };

      const score = 30 + (filingsMentioning * 10) + (totalMentions * 2);
      const confidence = (filingsMentioning / 4) * 0.8;

      if (!this.meetsConfidenceThreshold(confidence)) return null;

      return {
        instrumentId,
        signalType: SignalType.ETF_DISCLOSURE_REPEATED_PREM_DISC_EPISODES,
        severity: this.calculateSeverity(score, confidence),
        score,
        confidence,
        reason: `${filingsMentioning} of last ${filings.length} filings mention premium/discount issues (${totalMentions} total mentions), indicating persistent arbitrage friction`,
        evidenceFacts: [evidence],
        expiresAt: this.createEtfExpirationDate(context.currentTime),
      };
    } catch (error) {
      this.logger.debug({ instrumentId, error }, 'Error detecting repeated disclosure');
      return null;
    }
  }

  /**
   * Signal 2: Detect strategy drift
   */
  private async detectStrategyDrift(
    instrumentId: string,
    context: GeneratorContext
  ): Promise<GeneratedSignal | null> {
    try {
      // Get CIK for this instrument
      const cikIdentifier = await this.prisma.instrumentIdentifier.findFirst({
        where: { instrumentId, type: 'CIK' },
      });
      if (!cikIdentifier) return null;

      // Get last 3 N-CEN filings (annual)
      const result = await this.filingRepo.findByCik(cikIdentifier.value, {
        filingType: FilingType.FORM_N_CEN,
        limit: 3,
      });

      const filings = result.filings;
      if (filings.length < 2) return null;

      const [currentFiling, priorFiling] = filings;

      // Get content for both filings
      const currentContent = await this.filingRepo.findContentByFilingId(currentFiling.id);
      const priorContent = await this.filingRepo.findContentByFilingId(priorFiling.id);

      if (!currentContent || !priorContent) return null;

      // Extract strategy sections (try structured sections first, fallback to full text)
      const currentStrategy = this.extractStrategySection(
        currentContent.fullText,
        currentContent.sections
      );
      const priorStrategy = this.extractStrategySection(
        priorContent.fullText,
        priorContent.sections
      );

      if (!currentStrategy || !priorStrategy) return null;

      // Calculate text similarity
      const similarity = this.calculateTextSimilarity(currentStrategy, priorStrategy);

      // Check for index name changes
      const currentIndex = this.extractIndexName(currentStrategy);
      const priorIndex = this.extractIndexName(priorStrategy);
      const indexChanged = currentIndex !== priorIndex && !!currentIndex && !!priorIndex;

      // Trigger if similarity < 0.7 (30%+ change) OR index changed
      if (similarity >= 0.7 && !indexChanged) return null;

      const significantChanges: string[] = [];
      if (similarity < 0.7) {
        significantChanges.push(`Investment objective changed (${((1 - similarity) * 100).toFixed(0)}% text difference)`);
      }
      if (indexChanged) {
        significantChanges.push(`Index changed from "${priorIndex}" to "${currentIndex}"`);
      }

      const evidence: StrategyDriftEvidence = {
        type: 'STRATEGY_DRIFT',
        priorFilingId: priorFiling.id,
        currentFilingId: currentFiling.id,
        textSimilarity: similarity,
        indexNameChanged: indexChanged,
        objectiveChanged: similarity < 0.7,
        significantChanges,
      };

      const score = 40 + ((1 - similarity) * 50);
      const confidence = 0.7;

      if (!this.meetsConfidenceThreshold(confidence)) return null;

      return {
        instrumentId,
        signalType: SignalType.ETF_STRATEGY_DRIFT_INDICATOR,
        severity: this.calculateSeverity(score, confidence),
        score,
        confidence,
        reason: `Strategy drift detected: ${significantChanges.join('; ')}`,
        evidenceFacts: [evidence],
        expiresAt: this.createEtfExpirationDate(context.currentTime),
      };
    } catch (error) {
      this.logger.debug({ instrumentId, error }, 'Error detecting strategy drift');
      return null;
    }
  }

  /**
   * Signal 3: Detect basket policy changes
   */
  private async detectBasketPolicyChange(
    instrumentId: string,
    context: GeneratorContext
  ): Promise<GeneratedSignal | null> {
    try {
      // Get CIK for this instrument
      const cikIdentifier = await this.prisma.instrumentIdentifier.findFirst({
        where: { instrumentId, type: 'CIK' },
      });
      if (!cikIdentifier) return null;

      // Get last 4 N-CEN filings
      const result = await this.filingRepo.findByCik(cikIdentifier.value, {
        filingType: FilingType.FORM_N_CEN,
        limit: 4,
      });

      const filings = result.filings;
      if (filings.length < 4) return null;

      // Split into recent 2 and prior 2
      const recentFilings = filings.slice(0, 2);
      const priorFilings = filings.slice(2, 4);

      // Count mentions in recent filings
      let recentMentions = 0;
      const recentFilingIds: string[] = [];

      for (const filing of recentFilings) {
        const content = await this.filingRepo.findContentByFilingId(filing.id);
        if (!content) continue;

        const mentions = this.countKeywordMentions(
          content.fullText,
          this.BASKET_POLICY_KEYWORDS
        );

        if (mentions > 0) {
          recentMentions += mentions;
          recentFilingIds.push(filing.id);
        }
      }

      // Count mentions in prior filings
      let priorMentions = 0;
      for (const filing of priorFilings) {
        const content = await this.filingRepo.findContentByFilingId(filing.id);
        if (!content) continue;

        priorMentions += this.countKeywordMentions(
          content.fullText,
          this.BASKET_POLICY_KEYWORDS
        );
      }

      // Trigger if recent mentions > prior mentions
      if (recentMentions <= priorMentions) return null;

      const evidence: BasketPolicyChangeEvidence = {
        type: 'BASKET_POLICY_CHANGE',
        recentFilingsMentioning: recentFilingIds.length,
        totalMentions: recentMentions,
        filingIds: recentFilingIds,
        keywords: this.BASKET_POLICY_KEYWORDS,
      };

      const score = 35 + (recentMentions * 8);
      const confidence = 0.65;

      if (!this.meetsConfidenceThreshold(confidence)) return null;

      return {
        instrumentId,
        signalType: SignalType.ETF_BASKET_POLICY_CHANGE_SIGNAL,
        severity: this.calculateSeverity(score, confidence),
        score,
        confidence,
        reason: `Basket policy mentions increased in recent filings (${recentMentions} vs ${priorMentions} mentions), suggesting operational stress`,
        evidenceFacts: [evidence],
        expiresAt: this.createEtfExpirationDate(context.currentTime),
      };
    } catch (error) {
      this.logger.debug({ instrumentId, error }, 'Error detecting basket policy change');
      return null;
    }
  }

  /**
   * Count keyword mentions with word boundaries
   */
  private countKeywordMentions(text: string, keywords: string[]): number {
    let count = 0;
    const lowerText = text.toLowerCase();

    for (const keyword of keywords) {
      const regex = new RegExp(`\\b${keyword.toLowerCase()}\\b`, 'g');
      const matches = lowerText.match(regex);
      count += matches ? matches.length : 0;
    }

    return count;
  }

  /**
   * Extract strategy/objective section from filing
   */
  private extractStrategySection(
    fullText: string,
    sections: Record<string, string> | null
  ): string | null {
    // Try structured sections first
    if (sections) {
      const strategyKeys = ['Investment Objective', 'Investment Strategy', 'Fund Objective'];
      for (const key of strategyKeys) {
        if (sections[key]) {
          return sections[key];
        }
      }
    }

    // Fallback: extract from full text (look for common headings)
    const headingRegex = /Investment Objective[:\s]+([\s\S]{0,1000}?)(?=\n\n|\n[A-Z])/i;
    const match = fullText.match(headingRegex);
    return match ? match[1].trim() : null;
  }

  /**
   * Extract index name from strategy text
   */
  private extractIndexName(text: string): string | null {
    const indexRegex = /tracking (?:the )?([A-Z][A-Za-z0-9\s&]+Index)/;
    const match = text.match(indexRegex);
    return match ? match[1].trim() : null;
  }

  /**
   * Calculate text similarity using Levenshtein distance ratio
   */
  private calculateTextSimilarity(text1: string, text2: string): number {
    const norm1 = text1.toLowerCase().replace(/\s+/g, ' ').trim();
    const norm2 = text2.toLowerCase().replace(/\s+/g, ' ').trim();
    const editDistance = distance(norm1, norm2);
    const maxLength = Math.max(norm1.length, norm2.length);

    if (maxLength === 0) return 1.0;
    return 1 - (editDistance / maxLength);
  }

  /**
   * Create expiration date for ETF signals (90 days)
   */
  private createEtfExpirationDate(baseTime: Date): Date {
    const expirationMs = baseTime.getTime() + 90 * 24 * 60 * 60 * 1000;
    return new Date(expirationMs);
  }
}
