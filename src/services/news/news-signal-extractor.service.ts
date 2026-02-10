import { DocumentRepository } from '../../adapters/database/repositories/document.repository.js';
import { SignalRepository } from '../../adapters/database/repositories/signal.repository.js';
import { NewsStorageService } from './news-storage.service.js';
import { getEnvironment } from '../../config/environment.js';
import { getLogger } from '../../utils/logger.js';
import { DocumentRecord } from '../../types/document.types.js';
import { CreateSignalInput, SignalType, SignalSeverity } from '../../types/edgar.types.js';

/**
 * Extracted Signal with Evidence
 */
interface ExtractedSignal {
  signalType: SignalType;
  severity: SignalSeverity;
  score: number;
  reason: string;
  evidenceSnippet: string;
  matchedKeywords: string[];
}

/**
 * News Signal Extractor Service
 *
 * Extracts signals from downloaded article text using keyword pattern matching.
 *
 * Pipeline:
 * DOWNLOADED → ENRICHED (with InstrumentSignals created)
 * DOWNLOADED → FAILED (on error)
 *
 * Signal Types:
 * - BANKRUPTCY_INDICATOR
 * - FINANCING_EVENT
 * - LEGAL_REGULATORY_RISK
 * - MA_SPECULATION
 * - MANAGEMENT_INSTABILITY
 */
export class NewsSignalExtractorService {
  private documentRepo: DocumentRepository;
  private signalRepo: SignalRepository;
  private storage: NewsStorageService;
  private logger;

  constructor() {
    this.documentRepo = new DocumentRepository();
    this.signalRepo = new SignalRepository();
    this.storage = new NewsStorageService();
    this.logger = getLogger();
  }

  /**
   * Process downloaded articles (batch)
   *
   * @param batchSize Number of articles to process
   * @returns Number of articles successfully processed
   */
  async processDownloadedArticles(batchSize: number): Promise<number> {
    const downloaded = await this.documentRepo.findByStatusAndType(
      'DOWNLOADED',
      'NEWS_ARTICLE',
      batchSize,
    );

    if (downloaded.length === 0) {
      return 0;
    }

    this.logger.info(
      { count: downloaded.length },
      'Processing downloaded news articles for signal extraction',
    );

    let successCount = 0;

    for (const document of downloaded) {
      try {
        await this.extractSignalsFromDocument(document);
        successCount++;
      } catch (error) {
        this.logger.error(
          { err: error, documentId: document.id, phase: 'SIGNAL_EXTRACTION' },
          'Failed to extract signals from article',
        );
        // Error handling is done inside extractSignalsFromDocument
      }
    }

    this.logger.info(
      { total: downloaded.length, success: successCount },
      'Completed signal extraction batch',
    );

    return successCount;
  }

  /**
   * Extract signals from a single document
   *
   * @param document Document record
   */
  private async extractSignalsFromDocument(document: DocumentRecord): Promise<void> {
    if (!document.storagePath) {
      this.logger.warn(
        { documentId: document.id },
        'Document has no storage path, marking as failed',
      );
      await this.documentRepo.updateStatus(document.id, 'FAILED', {
        errorMessage: 'No storage path',
      });
      return;
    }

    try {
      // Load article content
      const content = await this.storage.retrieve(document.storagePath);

      if (!content || content.length < 50) {
        throw new Error('Article content too short or empty');
      }

      this.logger.debug(
        { documentId: document.id, contentLength: content.length },
        'Extracting signals from article',
      );

      // Run pattern matchers
      const signals = await this.extractSignals(document, content);

      this.logger.info(
        { documentId: document.id, signalCount: signals.length },
        'Extracted signals from article',
      );

      // Get linked instruments
      const instrumentLinks = await this.documentRepo.findInstrumentLinks(document.id);

      if (instrumentLinks.length === 0) {
        this.logger.debug(
          { documentId: document.id },
          'No instruments linked to article, skipping signal creation',
        );
      } else {
        // Create InstrumentSignal records for each extracted signal
        for (const signal of signals) {
          for (const link of instrumentLinks) {
            try {
              const signalInput: CreateSignalInput = {
                instrumentId: link.instrumentId,
                signalType: signal.signalType,
                severity: signal.severity,
                score: signal.score,
                reason: signal.reason,
                evidenceFacts: [
                  {
                    type: 'NEWS_SNIPPET',
                    documentId: document.id,
                    snippet: signal.evidenceSnippet,
                    keywords: signal.matchedKeywords,
                  },
                ],
                sourceFiling: null, // News signals have no filing reference
                computedAt: document.publishedAt, // Use article publish date
                expiresAt: null, // No expiration for news signals
              };

              await this.signalRepo.upsertSignal(signalInput);

              this.logger.debug(
                {
                  documentId: document.id,
                  instrumentId: link.instrumentId,
                  signalType: signal.signalType,
                },
                'Created instrument signal from news',
              );
            } catch (error) {
              this.logger.error(
                {
                  err: error,
                  documentId: document.id,
                  instrumentId: link.instrumentId,
                  signalType: signal.signalType,
                },
                'Failed to create instrument signal',
              );
              // Continue with next signal
            }
          }
        }
      }

      // Update status to ENRICHED
      await this.documentRepo.updateStatus(document.id, 'ENRICHED', {
        parsedAt: new Date(),
      });

      this.logger.info(
        { documentId: document.id, signalCount: signals.length },
        'Article signal extraction complete',
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        { err: error, documentId: document.id, phase: 'EXTRACTION_COMPLETE' },
        'Article signal extraction failed',
      );

      await this.documentRepo.updateStatus(document.id, 'FAILED', {
        errorMessage,
      });
    }
  }

  /**
   * Extract signals from article text using pattern matching
   *
   * @param document Document record
   * @param content Article text
   * @returns Array of extracted signals
   */
  private async extractSignals(
    document: DocumentRecord,
    content: string,
  ): Promise<ExtractedSignal[]> {
    const signals: ExtractedSignal[] = [];
    const env = getEnvironment();
    const minConfidence = env.SIGNAL_NEWS_MIN_CONFIDENCE;

    // Run each detector
    const detectors = [
      this.detectBankruptcySignal.bind(this),
      this.detectFinancingSignal.bind(this),
      this.detectLitigationSignal.bind(this),
      this.detectMASpeculationSignal.bind(this),
      this.detectManagementInstabilitySignal.bind(this),
    ];

    for (const detector of detectors) {
      const signal = detector(content);
      if (signal && signal.score / 100 >= minConfidence) {
        signals.push(signal);
      }
    }

    return signals;
  }

  /**
   * Detect bankruptcy indicators
   */
  private detectBankruptcySignal(text: string): ExtractedSignal | null {
    const pattern = /bankruptcy|chapter 11|insolvency|liquidation|administration/gi;
    const matches = text.match(pattern);

    if (!matches || matches.length === 0) {
      return null;
    }

    // Determine severity
    const highSeverityPattern = /filed.*bankruptcy|chapter 11.*filed|bankruptcy.*petition/i;
    const isHigh = highSeverityPattern.test(text);

    const severity: SignalSeverity = isHigh ? 'HIGH' : 'MEDIUM';
    const score = isHigh ? 90 : 75;

    // Extract evidence snippet
    const snippet = this.extractSnippet(text, pattern);

    return {
      signalType: 'BANKRUPTCY_INDICATOR',
      severity,
      score,
      reason: isHigh
        ? 'Bankruptcy filing announced in article'
        : 'Bankruptcy-related keywords detected in article',
      evidenceSnippet: snippet,
      matchedKeywords: [...new Set(matches.map((m) => m.toLowerCase()))],
    };
  }

  /**
   * Detect financing events
   */
  private detectFinancingSignal(text: string): ExtractedSignal | null {
    const pattern =
      /financing|capital raise|equity offering|dilution|ATM|shelf registration|raise.*capital|equity.*sale/gi;
    const matches = text.match(pattern);

    if (!matches || matches.length === 0) {
      return null;
    }

    // Determine severity
    const highSeverityPattern = /dilution|dilutive|atm|at-the-market/i;
    const isHigh = highSeverityPattern.test(text);

    const severity: SignalSeverity = isHigh ? 'HIGH' : 'MEDIUM';
    const score = isHigh ? 85 : 70;

    const snippet = this.extractSnippet(text, pattern);

    return {
      signalType: 'FINANCING_EVENT',
      severity,
      score,
      reason: isHigh
        ? 'Dilutive financing event detected in article'
        : 'Capital raising activity detected in article',
      evidenceSnippet: snippet,
      matchedKeywords: [...new Set(matches.map((m) => m.toLowerCase()))],
    };
  }

  /**
   * Detect legal/regulatory risks
   */
  private detectLitigationSignal(text: string): ExtractedSignal | null {
    const pattern =
      /lawsuit|litigation|SEC investigation|regulatory action|DOJ probe|subpoena|enforcement.*action|legal.*action/gi;
    const matches = text.match(pattern);

    if (!matches || matches.length === 0) {
      return null;
    }

    // Determine severity
    const highSeverityPattern = /DOJ|SEC investigation|criminal.*investigation|fraud.*charges/i;
    const isHigh = highSeverityPattern.test(text);

    const severity: SignalSeverity = isHigh ? 'HIGH' : 'MEDIUM';
    const score = isHigh ? 88 : 72;

    const snippet = this.extractSnippet(text, pattern);

    return {
      signalType: 'LEGAL_REGULATORY_RISK',
      severity,
      score,
      reason: isHigh
        ? 'Major regulatory or criminal investigation detected'
        : 'Legal or regulatory action detected in article',
      evidenceSnippet: snippet,
      matchedKeywords: [...new Set(matches.map((m) => m.toLowerCase()))],
    };
  }

  /**
   * Detect M&A speculation
   */
  private detectMASpeculationSignal(text: string): ExtractedSignal | null {
    const pattern =
      /acquisition|merger|buyout|takeover|strategic alternatives|exploring sale|potential.*acquisition|merger.*talks/gi;
    const matches = text.match(pattern);

    if (!matches || matches.length === 0) {
      return null;
    }

    // M&A speculation is generally MEDIUM severity
    const severity: SignalSeverity = 'MEDIUM';
    const score = 75;

    const snippet = this.extractSnippet(text, pattern);

    return {
      signalType: 'MA_SPECULATION',
      severity,
      score,
      reason: 'M&A activity or speculation detected in article',
      evidenceSnippet: snippet,
      matchedKeywords: [...new Set(matches.map((m) => m.toLowerCase()))],
    };
  }

  /**
   * Detect management instability
   */
  private detectManagementInstabilitySignal(text: string): ExtractedSignal | null {
    const pattern =
      /CEO.*resign|CFO.*depart|board shakeup|management change|succession.*plan|executive.*departure|CEO.*out/gi;
    const matches = text.match(pattern);

    if (!matches || matches.length === 0) {
      return null;
    }

    // Determine severity
    const highSeverityPattern = /CEO.*resign|CFO.*resign|CEO.*fired|CFO.*fired|CEO.*out/i;
    const isHigh = highSeverityPattern.test(text);

    const severity: SignalSeverity = isHigh ? 'HIGH' : 'MEDIUM';
    const score = isHigh ? 82 : 68;

    const snippet = this.extractSnippet(text, pattern);

    return {
      signalType: 'MANAGEMENT_INSTABILITY',
      severity,
      score,
      reason: isHigh
        ? 'CEO or CFO departure detected in article'
        : 'Management change detected in article',
      evidenceSnippet: snippet,
      matchedKeywords: [...new Set(matches.map((m) => m.toLowerCase()))],
    };
  }

  /**
   * Extract context snippet around pattern match (50 words)
   *
   * @param text Full text
   * @param pattern Regex pattern
   * @returns Evidence snippet
   */
  private extractSnippet(text: string, pattern: RegExp): string {
    const match = text.match(pattern);
    if (!match) {
      return text.substring(0, 200);
    }

    const matchIndex = text.indexOf(match[0]);
    const words = text.split(/\s+/);

    // Find word index
    let charCount = 0;
    let wordIndex = 0;
    for (let i = 0; i < words.length; i++) {
      charCount += words[i].length + 1; // +1 for space
      if (charCount >= matchIndex) {
        wordIndex = i;
        break;
      }
    }

    // Extract 25 words before and after
    const start = Math.max(0, wordIndex - 25);
    const end = Math.min(words.length, wordIndex + 25);

    const snippet = words.slice(start, end).join(' ');

    return `...${snippet}...`;
  }
}
