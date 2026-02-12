import { DocumentRepository } from '../../adapters/database/repositories/document.repository.js';
import { SignalRepository } from '../../adapters/database/repositories/signal.repository.js';
import { InstrumentRepository } from '../../adapters/database/repositories/instrument.repository.js';
import { TranscriptsStorage } from './storage.interface.js';
import { createTranscriptsStorage } from './storage.factory.js';
import { getEnvironment } from '../../config/environment.js';
import { getLogger } from '../../utils/logger.js';
import { DocumentRecord } from '../../types/document.types.js';
import { SignalType, SignalSeverity } from '../../types/edgar.types.js';
import {
  TranscriptEvidence,
  TranscriptSnippet,
  ParsedTranscript,
} from '../../types/transcripts.types.js';
import { Decimal } from '@prisma/client/runtime/library';

interface DetectedSignal {
  signalType: SignalType;
  severity: SignalSeverity;
  score: number;
  reason: string;
  evidence: TranscriptEvidence;
}

interface KeywordMatch {
  keyword: string;
  offset: number;
  text: string;
}

export class TranscriptsSignalExtractorService {
  private documentRepo: DocumentRepository;
  private signalRepo: SignalRepository;
  private instrumentRepo: InstrumentRepository;
  private storage: TranscriptsStorage;
  private logger;
  private minConfidence: number;
  private minKeywordDensity: number;

  constructor(storage?: TranscriptsStorage) {
    this.documentRepo = new DocumentRepository();
    this.signalRepo = new SignalRepository();
    this.instrumentRepo = new InstrumentRepository();
    this.storage = storage || createTranscriptsStorage();
    this.logger = getLogger();

    const env = getEnvironment();
    this.minConfidence = env.SIGNAL_TRANSCRIPT_MIN_CONFIDENCE;
    this.minKeywordDensity = env.SIGNAL_TRANSCRIPT_MIN_KEYWORD_DENSITY;
  }

  async processParsedTranscripts(batchSize: number): Promise<number> {
    const parsed = await this.documentRepo.findByStatusAndType(
      'PARSED',
      'EARNINGS_TRANSCRIPT',
      batchSize,
    );

    if (parsed.length === 0) {
      return 0;
    }

    this.logger.info(
      { count: parsed.length },
      'Processing parsed transcripts for signal extraction',
    );

    let successCount = 0;

    for (const document of parsed) {
      try {
        await this.extractSignalsFromTranscript(document);
        successCount++;
      } catch (error) {
        this.logger.error(
          { err: error, documentId: document.id, phase: 'SIGNAL_EXTRACTION' },
          'Failed to extract signals from transcript',
        );
      }
    }

    this.logger.info(
      { total: parsed.length, success: successCount },
      'Completed signal extraction batch',
    );

    return successCount;
  }

  private async extractSignalsFromTranscript(document: DocumentRecord): Promise<void> {
    if (!document.storagePath) {
      this.logger.warn({ documentId: document.id }, 'No storage path');
      return;
    }

    try {
      const content = await this.storage.retrieve(document.storagePath);
      const contentRecord = await this.documentRepo.findContentById(document.id);

      if (!contentRecord || !contentRecord.structured) {
        this.logger.warn({ documentId: document.id }, 'No structured data found');
        return;
      }

      const structured = contentRecord.structured as unknown as ParsedTranscript;
      const metadata = document.metadata as any;

      const documentInstruments = await this.documentRepo.findInstrumentsByDocumentId(
        document.id,
      );

      if (documentInstruments.length === 0) {
        this.logger.warn({ documentId: document.id }, 'No linked instruments');
        return;
      }

      const signals: DetectedSignal[] = [];

      const liquidityStress = this.detectLiquidityStress(content, structured, metadata, document);
      if (liquidityStress) signals.push(liquidityStress);

      const capitalRaise = this.detectCapitalRaiseImminent(content, structured, metadata, document);
      if (capitalRaise) signals.push(capitalRaise);

      const guidanceDeterioration = this.detectGuidanceDeterioration(content, structured, metadata, document);
      if (guidanceDeterioration) signals.push(guidanceDeterioration);

      const managementUncertainty = this.detectManagementUncertainty(content, structured, metadata, document);
      if (managementUncertainty) signals.push(managementUncertainty);

      const demandWeakness = this.detectDemandWeakness(content, structured, metadata, document);
      if (demandWeakness) signals.push(demandWeakness);

      const marginPressure = this.detectMarginPressure(content, structured, metadata, document);
      if (marginPressure) signals.push(marginPressure);

      const covenantStress = this.detectCovenantDebtStress(content, structured, metadata, document);
      if (covenantStress) signals.push(covenantStress);

      const restructuring = this.detectRestructuringLayoffs(content, structured, metadata, document);
      if (restructuring) signals.push(restructuring);

      const regulatorySetback = this.detectRegulatorySetback(content, structured, metadata, document);
      if (regulatorySetback) signals.push(regulatorySetback);

      const litigationRisk = this.detectLitigationRisk(content, structured, metadata, document);
      if (litigationRisk) signals.push(litigationRisk);

      const strategicAlternatives = this.detectStrategicAlternatives(content, structured, metadata, document);
      if (strategicAlternatives) signals.push(strategicAlternatives);

      for (const docInstrument of documentInstruments) {
        for (const signal of signals) {
          await this.signalRepo.upsert({
            instrumentId: docInstrument.instrumentId,
            signalType: signal.signalType as any,
            severity: signal.severity as any,
            score: new Decimal(signal.score),
            reason: signal.reason,
            evidenceFacts: signal.evidence as any,
            sourceFiling: null,
            expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
          });
        }
      }

      await this.documentRepo.updateStatus(document.id, 'ENRICHED', {
        enrichedAt: new Date(),
      });

      this.logger.info(
        {
          documentId: document.id,
          signalsExtracted: signals.length,
          instruments: documentInstruments.length,
        },
        'Signals extracted from transcript',
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        { err: error, documentId: document.id },
        'Failed to extract signals',
      );
      await this.documentRepo.updateStatus(document.id, 'FAILED', { errorMessage });
    }
  }

  private detectLiquidityStress(
    content: string,
    structured: ParsedTranscript,
    metadata: any,
    document: DocumentRecord,
  ): DetectedSignal | null {
    const keywords = [
      'cash runway', 'liquidity position', 'working capital', 'burn rate',
      'extend the runway', 'cash on hand', 'months of cash', 'operating cash flow',
      'liquidity crunch', 'cash constraints', 'funding needs', 'cash requirement',
      'near-term liquidity', 'access to capital', 'credit facility',
    ];

    const negations = [
      'adequate', 'sufficient', 'strong', 'comfortable',
      'improved', 'healthy', 'robust',
    ];

    const matches = this.findKeywordMatches(content, keywords, negations);
    if (matches.length === 0) return null;

    const wordCount = structured.metadata.totalWordCount;
    const density = this.calculateKeywordDensity(matches.length, wordCount);
    if (density < this.minKeywordDensity) return null;

    const runwayMatch = content.match(/(\d+)\s+months?\s+(?:of\s+)?(?:cash|runway)/i);
    const runwayMonths = runwayMatch ? parseInt(runwayMatch[1], 10) : undefined;

    let severity: SignalSeverity = 'LOW';
    if (matches.length >= 4 || runwayMonths !== undefined) {
      severity = 'HIGH';
    } else if (matches.length >= 2 || /tight|monitoring\s+closely/i.test(content)) {
      severity = 'MEDIUM';
    }

    if (
      (runwayMonths !== undefined && runwayMonths < 6) ||
      /insufficient|limited/i.test(content)
    ) {
      severity = 'CRITICAL';
    }

    let confidence = 0.6;
    if (density >= 3.0) confidence += 0.15;
    if (runwayMonths !== undefined) confidence += 0.10;
    confidence = Math.min(confidence, 0.95);

    if (confidence < this.minConfidence) return null;

    const snippets = this.extractSnippets(content, matches, structured, 3);
    const evidence: TranscriptEvidence = {
      documentId: document.id,
      symbol: metadata.symbol,
      fiscalQuarter: metadata.fiscalQuarter,
      callDate: document.publishedAt.toISOString(),
      snippets,
      quantitative: runwayMonths ? { runwayMonths } : undefined,
      confidence,
      keywordDensity: density,
    };

    return {
      signalType: 'LIQUIDITY_STRESS_CALL' as SignalType,
      severity,
      score: Math.round(confidence * 100),
      reason: runwayMonths
        ? `Company disclosed ${runwayMonths}-month cash runway with liquidity concerns`
        : `Company discussed liquidity position and cash management (${matches.length} mentions)`,
      evidence,
    };
  }

  private detectCapitalRaiseImminent(
    content: string,
    structured: ParsedTranscript,
    metadata: any,
    document: DocumentRecord,
  ): DetectedSignal | null {
    const keywords = [
      'ATM program', 'at-the-market', 'shelf registration', 'capital raise',
      'equity offering', 'financing transaction', 'raise capital', 'additional funding',
      'strategic financing', 'dilutive financing', 'shelf capacity', 'S-3 filing',
      'underwritten offering', 'private placement', 'public offering',
    ];

    const negations = [
      'no plans', 'not considering', 'not needed', 'not required',
      'adequate cash', 'well-capitalized',
    ];

    const matches = this.findKeywordMatches(content, keywords, negations);
    if (matches.length === 0) return null;

    const wordCount = structured.metadata.totalWordCount;
    const density = this.calculateKeywordDensity(matches.length, wordCount);
    if (density < this.minKeywordDensity) return null;

    const dollarMatch = content.match(/\$(\d+(?:\.\d+)?)\s*(?:million|M)\s+(?:shelf|offering|raise)/i);
    const dollarAmount = dollarMatch ? `$${dollarMatch[1]}M` : undefined;

    let severity: SignalSeverity = 'LOW';
    if (/considering|evaluating/i.test(content)) {
      severity = 'MEDIUM';
    }
    if (/intend to|planning/i.test(content)) {
      severity = 'HIGH';
    }
    if (/ATM.*activated|imminent|near-term.*transaction/i.test(content)) {
      severity = 'CRITICAL';
    }

    let confidence = 0.65;
    if (density >= 2.5) confidence += 0.15;
    if (/ATM|imminent/i.test(content)) confidence += 0.10;
    if (dollarAmount) confidence += 0.05;
    confidence = Math.min(confidence, 0.95);

    if (confidence < this.minConfidence) return null;

    const snippets = this.extractSnippets(content, matches, structured, 3);
    const evidence: TranscriptEvidence = {
      documentId: document.id,
      symbol: metadata.symbol,
      fiscalQuarter: metadata.fiscalQuarter,
      callDate: document.publishedAt.toISOString(),
      snippets,
      quantitative: dollarAmount ? { dollarAmount } : undefined,
      confidence,
      keywordDensity: density,
    };

    return {
      signalType: 'CAPITAL_RAISE_IMMINENT' as SignalType,
      severity,
      score: Math.round(confidence * 100),
      reason: dollarAmount
        ? `Company plans ${dollarAmount} capital raise or shelf utilization`
        : `Company discussing financing transactions (${matches.length} mentions)`,
      evidence,
    };
  }

  private detectGuidanceDeterioration(
    content: string,
    structured: ParsedTranscript,
    metadata: any,
    document: DocumentRecord,
  ): DetectedSignal | null {
    const keywords = [
      'lowering guidance', 'reducing guidance', 'withdraw guidance', 'suspending guidance',
      'revising guidance', 'guidance down', 'reduced outlook', 'lowered expectations',
      'cutting guidance', 'downward revision', 'guidance adjustment', 'outlook revision',
      'below prior guidance', 'revised downward', 'guidance reset',
    ];

    const negations = [
      'raising guidance', 'increasing guidance', 'improving outlook',
      'exceeding guidance', 'ahead of guidance', 'raised',
    ];

    const matches = this.findKeywordMatches(content, keywords, negations);
    if (matches.length === 0) return null;

    const wordCount = structured.metadata.totalWordCount;
    const density = this.calculateKeywordDensity(matches.length, wordCount);
    if (density < this.minKeywordDensity) return null;

    const percentMatch = content.match(/(?:down|lower|reducing)\s+(?:by\s+)?(\d+)%/i);
    const percentageChange = percentMatch ? parseInt(percentMatch[1], 10) : undefined;

    let severity: SignalSeverity = 'LOW';
    if (matches.length >= 2 || percentageChange !== undefined) {
      severity = 'MEDIUM';
    }
    if (/full-year|withdrawal/i.test(content) || (percentageChange && percentageChange > 20)) {
      severity = 'HIGH';
    }
    if (/suspend|significant.*revision/i.test(content)) {
      severity = 'CRITICAL';
    }

    let confidence = 0.70;
    if (density >= 2.0) confidence += 0.10;
    if (/withdraw|suspend/i.test(content)) confidence += 0.15;
    if (percentageChange && percentageChange > 15) confidence += 0.10;
    confidence = Math.min(confidence, 0.95);

    if (confidence < this.minConfidence) return null;

    const snippets = this.extractSnippets(content, matches, structured, 3);
    const evidence: TranscriptEvidence = {
      documentId: document.id,
      symbol: metadata.symbol,
      fiscalQuarter: metadata.fiscalQuarter,
      callDate: document.publishedAt.toISOString(),
      snippets,
      quantitative: percentageChange ? { percentageChange } : undefined,
      confidence,
      keywordDensity: density,
    };

    return {
      signalType: 'GUIDANCE_DETERIORATION' as SignalType,
      severity,
      score: Math.round(confidence * 100),
      reason: percentageChange
        ? `Guidance reduced by ${percentageChange}%`
        : `Company revised guidance downward (${matches.length} mentions)`,
      evidence,
    };
  }

  private detectManagementUncertainty(
    content: string,
    structured: ParsedTranscript,
    metadata: any,
    document: DocumentRecord,
  ): DetectedSignal | null {
    const keywords = [
      'uncertain', 'unclear', 'hard to predict', 'difficult to forecast',
      'limited visibility', 'no visibility', 'challenging to say', 'hard to say',
      'too early to tell', 'cannot comment', 'prefer not to', 'not in a position to',
      'premature to', 'difficult environment', 'elevated uncertainty',
    ];

    const negations = [
      'despite uncertainty', 'managing through', 'navigating well',
      'clear path', 'confident',
    ];

    const matches = this.findKeywordMatches(content, keywords, negations);
    if (matches.length === 0) return null;

    const wordCount = structured.metadata.totalWordCount;
    const density = this.calculateKeywordDensity(matches.length, wordCount);

    const qaMatches = this.findKeywordMatches(
      structured.sections.qaSession.text,
      keywords,
      negations,
    );
    const qaWordCount = structured.sections.qaSession.wordCount;
    const qaDensity = qaWordCount > 0
      ? this.calculateKeywordDensity(qaMatches.length, qaWordCount)
      : 0;

    if (density < this.minKeywordDensity) return null;

    let severity: SignalSeverity = 'LOW';
    if (matches.length >= 3 || qaMatches.length >= 2) {
      severity = 'MEDIUM';
    }
    if (matches.length >= 5 || qaMatches.length >= 3) {
      severity = 'HIGH';
    }
    if (/cannot provide guidance|refuse.*answer/i.test(content)) {
      severity = 'CRITICAL';
    }

    let confidence = 0.60;
    if (qaDensity >= 3.0) confidence += 0.15;
    if ((content.match(/cannot comment/gi) || []).length >= 2) confidence += 0.10;
    confidence = Math.min(confidence, 0.95);

    if (confidence < this.minConfidence) return null;

    const snippets = this.extractSnippets(content, matches, structured, 3);
    const evidence: TranscriptEvidence = {
      documentId: document.id,
      symbol: metadata.symbol,
      fiscalQuarter: metadata.fiscalQuarter,
      callDate: document.publishedAt.toISOString(),
      snippets,
      confidence,
      keywordDensity: density,
    };

    return {
      signalType: 'MANAGEMENT_UNCERTAINTY' as SignalType,
      severity,
      score: Math.round(confidence * 100),
      reason: `Excessive hedging language detected (${matches.length} instances, ${qaMatches.length} in Q&A)`,
      evidence,
    };
  }

  private detectDemandWeakness(
    content: string,
    structured: ParsedTranscript,
    metadata: any,
    document: DocumentRecord,
  ): DetectedSignal | null {
    const keywords = [
      'softening demand', 'demand weakness', 'elongated sales cycle', 'longer sales cycles',
      'customer hesitation', 'deal slippage', 'pipeline weakness', 'slower close rates',
      'elongated decision-making', 'customers delaying', 'softer bookings', 'bookings pressure',
      'conversion rates declining', 'pipeline velocity', 'budget scrutiny', 'deal pushouts', 'slower uptake',
    ];

    const negations = [
      'strong demand', 'robust demand', 'accelerating',
      'improving trends', 'demand recovery',
    ];

    const matches = this.findKeywordMatches(content, keywords, negations);
    if (matches.length === 0) return null;

    const wordCount = structured.metadata.totalWordCount;
    const density = this.calculateKeywordDensity(matches.length, wordCount);
    if (density < this.minKeywordDensity) return null;

    const cycleMatch = content.match(/sales\s+cycles?\s+(?:increased|longer|up)\s+(?:by\s+)?(\d+)%/i);
    const percentageChange = cycleMatch ? parseInt(cycleMatch[1], 10) : undefined;

    let severity: SignalSeverity = 'LOW';
    if (matches.length >= 2) {
      severity = 'MEDIUM';
    }
    if (percentageChange !== undefined || /material.*slippage/i.test(content)) {
      severity = 'HIGH';
    }
    if (/significant.*deterioration|materially.*weaker/i.test(content)) {
      severity = 'CRITICAL';
    }

    let confidence = 0.65;
    if (density >= 2.5) confidence += 0.10;
    if (percentageChange) confidence += 0.15;
    if (/material|significant/i.test(content)) confidence += 0.10;
    confidence = Math.min(confidence, 0.95);

    if (confidence < this.minConfidence) return null;

    const snippets = this.extractSnippets(content, matches, structured, 3);
    const evidence: TranscriptEvidence = {
      documentId: document.id,
      symbol: metadata.symbol,
      fiscalQuarter: metadata.fiscalQuarter,
      callDate: document.publishedAt.toISOString(),
      snippets,
      quantitative: percentageChange ? { percentageChange } : undefined,
      confidence,
      keywordDensity: density,
    };

    return {
      signalType: 'TRANSCRIPT_DEMAND_WEAKNESS' as SignalType,
      severity,
      score: Math.round(confidence * 100),
      reason: percentageChange
        ? `Sales cycles elongated by ${percentageChange}% amid demand weakness`
        : `Demand softening and pipeline weakness detected (${matches.length} mentions)`,
      evidence,
    };
  }

  private detectMarginPressure(
    content: string,
    structured: ParsedTranscript,
    metadata: any,
    document: DocumentRecord,
  ): DetectedSignal | null {
    const keywords = [
      'margin pressure', 'margin compression', 'pricing pressure', 'competitive pricing',
      'price competition', 'discounting', 'gross margin', 'margin headwinds',
      'cost pressures', 'pass through costs', 'absorbing costs', 'margin erosion',
      'pricing environment', 'pricing power', 'margin degradation', 'promotional activity',
    ];

    const negations = [
      'margin expansion', 'improving margins', 'pricing power intact',
      'maintaining pricing', 'margin recovery',
    ];

    const matches = this.findKeywordMatches(content, keywords, negations);
    if (matches.length === 0) return null;

    const wordCount = structured.metadata.totalWordCount;
    const density = this.calculateKeywordDensity(matches.length, wordCount);
    if (density < this.minKeywordDensity) return null;

    const marginMatch = content.match(/margin[s]?\s+(?:down|declined|compressed)\s+(?:by\s+)?(\d+)\s*(?:bps|basis points|%)/i);
    const percentageChange = marginMatch ? parseInt(marginMatch[1], 10) : undefined;

    let severity: SignalSeverity = 'LOW';
    if (/margin pressure|pricing.*headwind/i.test(content)) {
      severity = 'MEDIUM';
    }
    if (percentageChange !== undefined || /significant.*pressure/i.test(content)) {
      severity = 'HIGH';
    }
    if (/gross margin.*below 20|severe|unsustainable/i.test(content)) {
      severity = 'CRITICAL';
    }

    let confidence = 0.65;
    if (density >= 2.0) confidence += 0.10;
    if (percentageChange && percentageChange > 100) confidence += 0.15;
    if (/cannot pass through/i.test(content)) confidence += 0.10;
    confidence = Math.min(confidence, 0.95);

    if (confidence < this.minConfidence) return null;

    const snippets = this.extractSnippets(content, matches, structured, 3);
    const evidence: TranscriptEvidence = {
      documentId: document.id,
      symbol: metadata.symbol,
      fiscalQuarter: metadata.fiscalQuarter,
      callDate: document.publishedAt.toISOString(),
      snippets,
      quantitative: percentageChange ? { percentageChange } : undefined,
      confidence,
      keywordDensity: density,
    };

    return {
      signalType: 'TRANSCRIPT_MARGIN_PRESSURE' as SignalType,
      severity,
      score: Math.round(confidence * 100),
      reason: percentageChange
        ? `Gross margin compressed by ${percentageChange} bps`
        : `Margin pressure and pricing headwinds (${matches.length} mentions)`,
      evidence,
    };
  }

  private detectCovenantDebtStress(
    content: string,
    structured: ParsedTranscript,
    metadata: any,
    document: DocumentRecord,
  ): DetectedSignal | null {
    const keywords = [
      'covenant', 'debt covenant', 'loan covenant', 'covenant compliance',
      'covenant breach', 'covenant waiver', 'covenant amendment', 'covenant relief',
      'covenant test', 'financial covenant', 'leverage ratio', 'debt ratio',
      'credit agreement', 'lender waiver', 'technical default', 'covenant violation', 'covenant headroom',
    ];

    const negations = [
      'covenant compliance', 'well within covenants', 'comfortable headroom',
      'ample headroom', 'no covenant concerns',
    ];

    const matches = this.findKeywordMatches(content, keywords, negations);
    if (matches.length === 0) return null;

    const wordCount = structured.metadata.totalWordCount;
    const density = this.calculateKeywordDensity(matches.length, wordCount);
    if (density < this.minKeywordDensity) return null;

    let severity: SignalSeverity = 'LOW';
    if (/monitoring closely|headroom reduced/i.test(content)) {
      severity = 'MEDIUM';
    }
    if (/waiver.*obtained|amendment.*negotiated/i.test(content)) {
      severity = 'HIGH';
    }
    if (/breach.*occurred|at risk of|expect to breach|seeking.*waiver/i.test(content)) {
      severity = 'CRITICAL';
    }

    let confidence = 0.70;
    if (density >= 1.5) confidence += 0.10;
    if (/breach|violation/i.test(content)) confidence += 0.15;
    if (/waiver.*seeking/i.test(content)) confidence += 0.10;
    confidence = Math.min(confidence, 0.95);

    if (confidence < this.minConfidence) return null;

    const snippets = this.extractSnippets(content, matches, structured, 3);
    const evidence: TranscriptEvidence = {
      documentId: document.id,
      symbol: metadata.symbol,
      fiscalQuarter: metadata.fiscalQuarter,
      callDate: document.publishedAt.toISOString(),
      snippets,
      confidence,
      keywordDensity: density,
    };

    return {
      signalType: 'TRANSCRIPT_COVENANT_DEBT_STRESS' as SignalType,
      severity,
      score: Math.round(confidence * 100),
      reason: `Debt covenant stress detected (${matches.length} mentions)`,
      evidence,
    };
  }

  private detectRestructuringLayoffs(
    content: string,
    structured: ParsedTranscript,
    metadata: any,
    document: DocumentRecord,
  ): DetectedSignal | null {
    const keywords = [
      'layoffs', 'workforce reduction', 'headcount reduction', 'restructuring',
      'rightsizing', 'cost reduction', 'cost-cutting', 'facility closure',
      'office consolidation', 'reduction in force', 'RIF', 'organizational restructuring',
      'streamlining operations', 'headcount actions', 'severance', 'eliminating positions',
    ];

    const negations = [
      'hiring', 'adding headcount', 'expanding', 'growing team',
    ];

    const matches = this.findKeywordMatches(content, keywords, negations);
    if (matches.length === 0) return null;

    const wordCount = structured.metadata.totalWordCount;
    const density = this.calculateKeywordDensity(matches.length, wordCount);
    if (density < this.minKeywordDensity) return null;

    const headcountMatch = content.match(/(?:reducing|eliminating|cutting)\s+(?:approximately\s+)?(\d+(?:,\d+)?)\s+(?:positions|jobs|employees)/i);
    const headcountNumber = headcountMatch
      ? parseInt(headcountMatch[1].replace(/,/g, ''), 10)
      : undefined;

    const percentMatch = content.match(/headcount\s+reduction\s+of\s+(?:approximately\s+)?(\d+)%/i);
    const percentReduction = percentMatch ? parseInt(percentMatch[1], 10) : undefined;

    let severity: SignalSeverity = 'LOW';
    if (headcountNumber !== undefined || percentReduction !== undefined) {
      if (percentReduction && percentReduction < 10) {
        severity = 'MEDIUM';
      } else if (percentReduction && percentReduction >= 10 && percentReduction < 20) {
        severity = 'HIGH';
      } else if (percentReduction && percentReduction >= 20) {
        severity = 'CRITICAL';
      } else {
        severity = 'MEDIUM';
      }
    }
    if (/facility closure/i.test(content)) {
      severity = severity === 'LOW' ? 'MEDIUM' : 'HIGH';
    }

    let confidence = 0.70;
    if (density >= 2.0) confidence += 0.10;
    if (headcountNumber !== undefined || percentReduction !== undefined) confidence += 0.15;
    if (/severance charge/i.test(content)) confidence += 0.05;
    confidence = Math.min(confidence, 0.95);

    if (confidence < this.minConfidence) return null;

    const snippets = this.extractSnippets(content, matches, structured, 3);
    const evidence: TranscriptEvidence = {
      documentId: document.id,
      symbol: metadata.symbol,
      fiscalQuarter: metadata.fiscalQuarter,
      callDate: document.publishedAt.toISOString(),
      snippets,
      quantitative: headcountNumber
        ? { headcountReduction: headcountNumber }
        : percentReduction
        ? { percentageChange: percentReduction }
        : undefined,
      confidence,
      keywordDensity: density,
    };

    return {
      signalType: 'TRANSCRIPT_RESTRUCTURING_LAYOFFS' as SignalType,
      severity,
      score: Math.round(confidence * 100),
      reason: headcountNumber
        ? `Restructuring with ${headcountNumber} position eliminations`
        : percentReduction
        ? `Headcount reduction of ${percentReduction}%`
        : `Restructuring and cost-cutting announced (${matches.length} mentions)`,
      evidence,
    };
  }

  private detectRegulatorySetback(
    content: string,
    structured: ParsedTranscript,
    metadata: any,
    document: DocumentRecord,
  ): DetectedSignal | null {
    const keywords = [
      'FDA delay', 'FDA hold', 'clinical hold', 'complete response letter',
      'CRL', 'regulatory delay', 'regulatory setback', 'FDA rejection',
      'approval delay', 'regulatory hurdle', 'compliance issue', 'warning letter',
      'consent decree', 'import ban', 'manufacturing hold', 'regulatory pathway',
      'FDA feedback', 'additional studies required',
    ];

    const negations = [
      'FDA approval', 'regulatory approval', 'cleared by FDA',
      'on track', 'progressing well',
    ];

    const matches = this.findKeywordMatches(content, keywords, negations);
    if (matches.length === 0) return null;

    const wordCount = structured.metadata.totalWordCount;
    const density = this.calculateKeywordDensity(matches.length, wordCount);
    if (density < this.minKeywordDensity) return null;

    let severity: SignalSeverity = 'LOW';
    if (/approval.*delayed|timeline.*delay/i.test(content)) {
      severity = 'MEDIUM';
    }
    if (/clinical hold|complete response letter|CRL/i.test(content)) {
      severity = 'HIGH';
    }
    if (/program.*termination|warning letter|consent decree/i.test(content)) {
      severity = 'CRITICAL';
    }

    let confidence = 0.75;
    if (density >= 1.5) confidence += 0.10;
    if (/CRL|clinical hold/i.test(content)) confidence += 0.15;
    confidence = Math.min(confidence, 0.95);

    if (confidence < this.minConfidence) return null;

    const snippets = this.extractSnippets(content, matches, structured, 3);
    const evidence: TranscriptEvidence = {
      documentId: document.id,
      symbol: metadata.symbol,
      fiscalQuarter: metadata.fiscalQuarter,
      callDate: document.publishedAt.toISOString(),
      snippets,
      confidence,
      keywordDensity: density,
    };

    return {
      signalType: 'TRANSCRIPT_REGULATORY_SETBACK' as SignalType,
      severity,
      score: Math.round(confidence * 100),
      reason: `Regulatory setback or delay detected (${matches.length} mentions)`,
      evidence,
    };
  }

  private detectLitigationRisk(
    content: string,
    structured: ParsedTranscript,
    metadata: any,
    document: DocumentRecord,
  ): DetectedSignal | null {
    const keywords = [
      'lawsuit', 'litigation', 'class action', 'legal proceedings',
      'settlement', 'investigation', 'DOJ investigation', 'SEC investigation',
      'subpoena', 'legal liability', 'legal exposure', 'adverse judgment',
      'legal claims', 'patent litigation', 'infringement claim', 'damages', 'injunction',
    ];

    const negations = [
      'lawsuit dismissed', 'claims without merit', 'favorable ruling',
      'settled favorably', 'no merit',
    ];

    const matches = this.findKeywordMatches(content, keywords, negations);
    if (matches.length === 0) return null;

    const wordCount = structured.metadata.totalWordCount;
    const density = this.calculateKeywordDensity(matches.length, wordCount);
    if (density < this.minKeywordDensity) return null;

    const settlementMatch = content.match(/settlement\s+of\s+\$(\d+(?:\.\d+)?)\s*(?:million|M)/i);
    const dollarAmount = settlementMatch ? `$${settlementMatch[1]}M` : undefined;
    const settlementValue = settlementMatch ? parseFloat(settlementMatch[1]) : undefined;

    let severity: SignalSeverity = 'LOW';
    if (/lawsuit.*filed|investigation.*opened/i.test(content)) {
      severity = 'MEDIUM';
    }
    if (/class action|DOJ|SEC investigation/i.test(content)) {
      severity = 'HIGH';
    }
    if (
      /adverse judgment/i.test(content) ||
      (settlementValue !== undefined && settlementValue > 50)
    ) {
      severity = 'CRITICAL';
    }

    let confidence = 0.70;
    if (density >= 1.5) confidence += 0.10;
    if (/class action|DOJ/i.test(content)) confidence += 0.15;
    if (settlementValue && settlementValue > 10) confidence += 0.10;
    confidence = Math.min(confidence, 0.95);

    if (confidence < this.minConfidence) return null;

    const snippets = this.extractSnippets(content, matches, structured, 3);
    const evidence: TranscriptEvidence = {
      documentId: document.id,
      symbol: metadata.symbol,
      fiscalQuarter: metadata.fiscalQuarter,
      callDate: document.publishedAt.toISOString(),
      snippets,
      quantitative: dollarAmount ? { dollarAmount } : undefined,
      confidence,
      keywordDensity: density,
    };

    return {
      signalType: 'TRANSCRIPT_LITIGATION_RISK' as SignalType,
      severity,
      score: Math.round(confidence * 100),
      reason: dollarAmount
        ? `Litigation with ${dollarAmount} settlement or reserve`
        : `Material litigation or investigation disclosed (${matches.length} mentions)`,
      evidence,
    };
  }

  private detectStrategicAlternatives(
    content: string,
    structured: ParsedTranscript,
    metadata: any,
    document: DocumentRecord,
  ): DetectedSignal | null {
    const keywords = [
      'strategic alternatives', 'strategic review', 'strategic options', 'exploring alternatives',
      'evaluating strategic', 'strategic process', 'sale process', 'potential transaction',
      'M&A process', 'maximizing shareholder value', 'strategic transaction', 'recapitalization',
      'going private', 'take private', 'wind down', 'orderly liquidation',
    ];

    const negations = [
      'not exploring', 'no plans to sell', 'committed to independence',
      'focused on execution',
    ];

    const matches = this.findKeywordMatches(content, keywords, negations);
    if (matches.length === 0) return null;

    const wordCount = structured.metadata.totalWordCount;
    const density = this.calculateKeywordDensity(matches.length, wordCount);
    if (density < this.minKeywordDensity) return null;

    let severity: SignalSeverity = 'MEDIUM';
    if (/exploring strategic alternatives|retained.*advisor/i.test(content)) {
      severity = 'HIGH';
    }
    if (/sale process.*underway|wind down|liquidation/i.test(content)) {
      severity = 'CRITICAL';
    }

    let confidence = 0.75;
    if (/strategic alternatives/i.test(content)) {
      confidence = 0.85;
    }
    if (/retained.*advisor/i.test(content)) {
      confidence += 0.10;
    }
    if (/sale process|liquidation/i.test(content)) {
      confidence = 0.95;
    }
    confidence = Math.min(confidence, 0.95);

    if (confidence < this.minConfidence) return null;

    const snippets = this.extractSnippets(content, matches, structured, 3);
    const evidence: TranscriptEvidence = {
      documentId: document.id,
      symbol: metadata.symbol,
      fiscalQuarter: metadata.fiscalQuarter,
      callDate: document.publishedAt.toISOString(),
      snippets,
      confidence,
      keywordDensity: density,
    };

    return {
      signalType: 'TRANSCRIPT_STRATEGIC_ALTERNATIVES' as SignalType,
      severity,
      score: Math.round(confidence * 100),
      reason: 'Company exploring strategic alternatives or sale process',
      evidence,
    };
  }

  private findKeywordMatches(
    content: string,
    keywords: string[],
    negations: string[],
  ): KeywordMatch[] {
    const matches: KeywordMatch[] = [];

    for (const keyword of keywords) {
      const regex = new RegExp(keyword, 'gi');
      let match;

      const exec_result = regex.exec(content);
      while (exec_result !== null) {
        const offset = exec_result.index;
        const contextStart = Math.max(0, offset - 100);
        const contextEnd = Math.min(content.length, offset + 100);
        const context = content.substring(contextStart, contextEnd);

        const hasNegation = negations.some((neg) =>
          new RegExp(neg, 'i').test(context),
        );

        if (!hasNegation) {
          matches.push({
            keyword,
            offset,
            text: exec_result[0],
          });
        }

        const next_result = regex.exec(content);
        if (!next_result) break;
        match = next_result;
      }
    }

    return matches;
  }

  private extractSnippets(
    content: string,
    matches: KeywordMatch[],
    structured: ParsedTranscript,
    maxSnippets: number,
  ): TranscriptSnippet[] {
    const snippets: TranscriptSnippet[] = [];
    const matchesToProcess = matches.slice(0, maxSnippets);

    for (const match of matchesToProcess) {
      const snippetStart = Math.max(0, match.offset - 75);
      const snippetEnd = Math.min(content.length, match.offset + 75);
      const text = content.substring(snippetStart, snippetEnd).trim();

      const preparedRemarksEnd = structured.sections.preparedRemarks.text.length;
      const section =
        match.offset < preparedRemarksEnd ? 'PREPARED_REMARKS' : 'QA_SESSION';

      const speaker = this.findSpeakerAtOffset(
        content,
        match.offset,
        structured.speakers,
      );

      snippets.push({
        text,
        speaker,
        section,
        offset: match.offset,
        keywords: [match.keyword],
      });
    }

    return snippets;
  }

  private findSpeakerAtOffset(
    content: string,
    offset: number,
    speakers: Record<string, string>,
  ): string {
    const precedingText = content.substring(Math.max(0, offset - 500), offset);

    for (const [name, title] of Object.entries(speakers)) {
      if (precedingText.includes(name)) {
        return `${title} - ${name}`;
      }
    }

    return 'Unknown';
  }

  private calculateKeywordDensity(matches: number, wordCount: number): number {
    if (wordCount === 0) return 0;
    return (matches / wordCount) * 1000;
  }
}
