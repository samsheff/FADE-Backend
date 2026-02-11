import { FilingRepository } from '../../adapters/database/repositories/filing.repository.js';
import { getLogger } from '../../utils/logger.js';
import { FactType, FilingStatus } from '../../types/edgar.types.js';

interface FactMatch {
  factType: FactType;
  data: Record<string, unknown>;
  evidence: string;
  confidence: number;
}

/**
 * Fact Extractor Service
 * Extracts structured facts from parsed filing text using pattern matching
 */
export class FactExtractorService {
  private filingRepo: FilingRepository;
  private logger;

  // Pattern definitions for fact detection
  private readonly PATTERNS: Record<FactType, RegExp[]> = {
    [FactType.ATM_PROGRAM]: [
      /at-the-market.*offering/i,
      /ATM.*agreement/i,
      /equity distribution agreement/i,
      /controlled equity offering/i,
    ],
    [FactType.SHELF_REGISTRATION]: [
      /Form S-3.*effective/i,
      /shelf registration.*declared effective/i,
      /registration statement.*was declared effective/i,
      /shelf.*\$[\d,.]+\s*(?:million|billion)/i,
    ],
    [FactType.CONVERTIBLE_DEBT]: [
      /convertible.*note/i,
      /conversion price.*\$[\d.]+/i,
      /death spiral/i,
      /convertible promissory note/i,
      /convertible debenture/i,
    ],
    [FactType.REVERSE_SPLIT]: [
      /reverse.*stock.*split/i,
      /1-for-(\d+).*reverse/i,
      /reverse split.*ratio.*1:(\d+)/i,
      /combine.*outstanding shares/i,
    ],
    [FactType.GOING_CONCERN]: [
      /substantial doubt.*ability to continue/i,
      /going concern/i,
      /doubt about.*entity.*ability to continue as a going concern/i,
      /may not.*able to continue.*going concern/i,
    ],
    [FactType.LIQUIDITY_STRESS]: [
      /insufficient.*working capital/i,
      /lack of liquidity/i,
      /may not have sufficient.*to fund/i,
      /limited cash.*resources/i,
      /need.*additional financing.*near term/i,
    ],
    [FactType.EQUITY_RAISE]: [
      /public offering.*\$[\d,.]+\s*million/i,
      /underwritten offering/i,
      /raise.*\$[\d,.]+\s*million/i,
      /sale of.*shares.*aggregate.*\$/i,
    ],
    [FactType.DIRECTOR_RESIGNATION]: [
      /director.*resigned/i,
      /resignation.*director/i,
      /member of the board.*resigned/i,
    ],
    [FactType.COVENANT_BREACH]: [
      /covenant.*breach/i,
      /default.*loan agreement/i,
      /non-compliance.*financial covenant/i,
      /violated.*debt covenant/i,
    ],
    [FactType.RESTATEMENT]: [
      /restatement.*financial statements/i,
      /restated.*results/i,
      /material misstatement/i,
      /accounting error.*restate/i,
    ],
  };

  constructor() {
    this.filingRepo = new FilingRepository();
    this.logger = getLogger();
  }

  /**
   * Extract facts from PARSED filings
   * @param limit - Maximum number of filings to process in this batch
   * @returns Number of filings successfully processed
   */
  async extractFactsFromParsedFilings(limit = 10): Promise<number> {
    this.logger.info({ limit }, 'Extracting facts from parsed filings');

    const parsed = await this.filingRepo.findByStatus(FilingStatus.PARSED, limit);

    if (parsed.length === 0) {
      this.logger.debug('No parsed filings to extract facts from');
      return 0;
    }

    let successCount = 0;

    for (const filing of parsed) {
      try {
        const content = await this.filingRepo.findContentByFilingId(filing.id);

        if (!content) {
          throw new Error('Filing content not found');
        }

        // Extract facts from full text
        const facts = this.extractFacts(content.fullText);

        if (facts.length > 0) {
          // Batch insert facts
          await this.filingRepo.batchInsertFacts(
            facts.map((fact) => ({
              filingId: filing.id,
              factType: fact.factType,
              data: fact.data,
              evidence: fact.evidence,
              confidence: fact.confidence,
            })),
          );

          this.logger.info(
            {
              filingId: filing.id,
              factCount: facts.length,
              types: [...new Set(facts.map((f) => f.factType))],
            },
            'Extracted facts',
          );
        } else {
          this.logger.debug(
            { filingId: filing.id },
            'No facts extracted from filing',
          );
        }

        // Update filing status to ENRICHED
        await this.filingRepo.updateStatus(filing.id, FilingStatus.ENRICHED);

        successCount++;
      } catch (error) {
        this.logger.error(
          {
            filingId: filing.id,
            error,
          },
          'Failed to extract facts',
        );

        await this.filingRepo.updateStatus(filing.id, FilingStatus.FAILED, {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.info(
      { total: parsed.length, success: successCount },
      'Completed fact extraction batch',
    );

    return successCount;
  }

  /**
   * Extract all facts from text
   */
  private extractFacts(text: string): FactMatch[] {
    const facts: FactMatch[] = [];

    // Run all pattern matchers
    for (const [factType, patterns] of Object.entries(this.PATTERNS)) {
      const matches = this.findMatches(
        text,
        patterns,
        factType as FactType,
      );
      facts.push(...matches);
    }

    return facts;
  }

  /**
   * Find all matches for a given fact type's patterns
   */
  private findMatches(
    text: string,
    patterns: RegExp[],
    factType: FactType,
  ): FactMatch[] {
    const matches: FactMatch[] = [];

    for (const pattern of patterns) {
      const regex = new RegExp(pattern, 'gi');
      let match;

      while ((match = regex.exec(text)) !== null) {
        const snippet = this.extractSnippet(text, match.index, 200);
        const data = this.extractFactData(factType, match, snippet);

        matches.push({
          factType,
          data,
          evidence: snippet,
          confidence: this.calculateConfidence(factType, match, snippet),
        });
      }
    }

    return matches;
  }

  /**
   * Extract snippet around match
   */
  private extractSnippet(
    text: string,
    index: number,
    radius: number,
  ): string {
    const start = Math.max(0, index - radius);
    const end = Math.min(text.length, index + radius);
    return text.substring(start, end).trim();
  }

  /**
   * Extract structured data from match
   */
  private extractFactData(
    factType: FactType,
    match: RegExpExecArray,
    snippet: string,
  ): Record<string, unknown> {
    const data: Record<string, unknown> = {
      matchedText: match[0],
    };

    switch (factType) {
      case FactType.SHELF_REGISTRATION:
      case FactType.EQUITY_RAISE:
        // Extract dollar amounts
        const amountMatch = snippet.match(/\$?([\d,.]+)\s*(million|billion)/i);
        if (amountMatch) {
          const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
          const multiplier = amountMatch[2].toLowerCase() === 'billion' ? 1000 : 1;
          data.amountMillions = amount * multiplier;
        }
        break;

      case FactType.REVERSE_SPLIT:
        // Extract split ratio
        const ratioMatch = snippet.match(/1[-:]?for[-:]?(\d+)|1:(\d+)/i);
        if (ratioMatch) {
          data.ratio = parseInt(ratioMatch[1] || ratioMatch[2]);
        }
        break;

      case FactType.CONVERTIBLE_DEBT:
        // Extract conversion price
        const priceMatch = snippet.match(/conversion price.*\$([\d.]+)/i);
        if (priceMatch) {
          data.conversionPrice = parseFloat(priceMatch[1]);
        }
        break;

      default:
        // No specific data extraction for other types
        break;
    }

    return data;
  }

  /**
   * Calculate confidence score for a match
   */
  private calculateConfidence(
    factType: FactType,
    match: RegExpExecArray,
    snippet: string,
  ): number {
    let confidence = 0.7; // Base confidence

    // Boost confidence for longer matches (more specific)
    if (match[0].length > 20) {
      confidence += 0.1;
    }

    // Boost confidence if numbers are present (more concrete)
    if (/\$?[\d,.]+/.test(snippet)) {
      confidence += 0.1;
    }

    // Boost confidence for specific keywords
    const highConfidenceKeywords: Record<FactType, string[]> = {
      [FactType.GOING_CONCERN]: ['substantial doubt', 'ability to continue'],
      [FactType.SHELF_REGISTRATION]: ['declared effective', 'registration statement'],
      [FactType.REVERSE_SPLIT]: ['reverse stock split', 'combine outstanding shares'],
      [FactType.ATM_PROGRAM]: ['equity distribution agreement'],
      [FactType.CONVERTIBLE_DEBT]: ['convertible promissory note'],
      [FactType.LIQUIDITY_STRESS]: ['insufficient working capital'],
      [FactType.EQUITY_RAISE]: ['underwritten offering'],
      [FactType.DIRECTOR_RESIGNATION]: ['director resigned'],
      [FactType.COVENANT_BREACH]: ['covenant breach', 'default'],
      [FactType.RESTATEMENT]: ['restatement', 'material misstatement'],
    };

    const keywords = highConfidenceKeywords[factType] || [];
    for (const keyword of keywords) {
      if (snippet.toLowerCase().includes(keyword.toLowerCase())) {
        confidence += 0.1;
        break;
      }
    }

    return Math.min(confidence, 1.0);
  }
}
