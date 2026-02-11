import { FilingRepository } from '../../adapters/database/repositories/filing.repository.js';
import { FilingStorage } from './storage.interface.js';
import { createFilingStorage } from './storage.factory.js';
import { getLogger } from '../../utils/logger.js';
import { FilingType, FilingStatus } from '../../types/edgar.types.js';

/**
 * Filing Parser Service
 * Parses downloaded HTML/XBRL filings to extract text and sections
 */
export class FilingParserService {
  private filingRepo: FilingRepository;
  private storage: FilingStorage;
  private logger;

  constructor(storage?: FilingStorage) {
    this.filingRepo = new FilingRepository();
    this.storage = storage || createFilingStorage();
    this.logger = getLogger();
  }

  /**
   * Parse DOWNLOADED filings
   * @param limit - Maximum number of filings to parse in this batch
   * @returns Number of filings successfully parsed
   */
  async parseDownloadedFilings(limit = 10): Promise<number> {
    this.logger.info({ limit }, 'Parsing downloaded filings');

    const downloaded = await this.filingRepo.findByStatus(FilingStatus.DOWNLOADED, limit);

    if (downloaded.length === 0) {
      this.logger.debug('No downloaded filings to parse');
      return 0;
    }

    let successCount = 0;

    for (const filing of downloaded) {
      try {
        if (!filing.storagePath) {
          throw new Error('Filing has no storage path');
        }

        // Read filing content from storage
        const raw = await this.storage.read(filing.storagePath);

        // Parse HTML to text
        const fullText = this.htmlToText(raw.toString('utf-8'));

        // Extract sections based on filing type
        const sections = this.extractSections(fullText, filing.filingType);

        // Extract exhibits
        const exhibits = this.extractExhibits(raw.toString('utf-8'));

        // Save parsed content
        await this.filingRepo.createContent(filing.id, {
          fullText,
          sections,
          exhibits,
        });

        // Update filing status
        await this.filingRepo.updateStatus(filing.id, FilingStatus.PARSED, {
          parsedAt: new Date(),
        });

        this.logger.info(
          {
            filingId: filing.id,
            wordCount: fullText.split(/\s+/).length,
            sections: Object.keys(sections).length,
          },
          'Parsed filing',
        );

        successCount++;
      } catch (error) {
        this.logger.error(
          {
            filingId: filing.id,
            error,
          },
          'Failed to parse filing',
        );

        await this.filingRepo.updateStatus(filing.id, FilingStatus.FAILED, {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.info(
      { total: downloaded.length, success: successCount },
      'Completed parsing batch',
    );

    return successCount;
  }

  /**
   * Convert HTML to plain text
   * Strips tags and normalizes whitespace
   */
  private htmlToText(html: string): string {
    // Remove script and style tags
    let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, ' ');

    // Decode HTML entities
    text = this.decodeHtmlEntities(text);

    // Normalize whitespace
    text = text.replace(/\s+/g, ' ').trim();

    return text;
  }

  /**
   * Decode common HTML entities
   */
  private decodeHtmlEntities(text: string): string {
    const entities: Record<string, string> = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&nbsp;': ' ',
    };

    return text.replace(/&[a-z]+;|&#\d+;/gi, (match) => {
      return entities[match.toLowerCase()] || match;
    });
  }

  /**
   * Extract sections from filing based on type
   */
  private extractSections(
    text: string,
    filingType: FilingType,
  ): Record<string, string> {
    const sections: Record<string, string> = {};

    switch (filingType) {
      case FilingType.FORM_8K:
        // Extract 8-K items
        this.extract8KItems(text, sections);
        break;

      case FilingType.FORM_10Q:
      case FilingType.FORM_10K:
        // Extract 10-Q/10-K parts
        this.extract10KParts(text, sections);
        break;

      case FilingType.FORM_424B5:
      case FilingType.FORM_S3:
        // Extract prospectus sections
        this.extractProspectusSections(text, sections);
        break;

      case FilingType.FORM_N_CEN:
        // Extract N-CEN sections (ETF annual report)
        this.extractNCENSections(text, sections);
        break;

      case FilingType.FORM_N_PORT:
        // Extract N-PORT sections (ETF quarterly holdings)
        this.extractNPORTSections(text, sections);
        break;

      default:
        // No specific sections for other types
        break;
    }

    return sections;
  }

  /**
   * Extract 8-K items
   */
  private extract8KItems(text: string, sections: Record<string, string>): void {
    const itemPattern = /Item\s+(\d+\.\d+)[:\s]+([^\n]+)/gi;
    let match;

    while ((match = itemPattern.exec(text)) !== null) {
      const itemNumber = match[1];
      const itemTitle = match[2].trim();
      sections[`Item ${itemNumber}`] = itemTitle;
    }
  }

  /**
   * Extract 10-K/10-Q parts
   */
  private extract10KParts(text: string, sections: Record<string, string>): void {
    const partPattern = /(?:PART|Part)\s+([IVX]+)[:\s]+([^\n]+)/gi;
    let match;

    while ((match = partPattern.exec(text)) !== null) {
      const partNumber = match[1];
      const partTitle = match[2].trim();
      sections[`Part ${partNumber}`] = partTitle;
    }
  }

  /**
   * Extract prospectus sections
   */
  private extractProspectusSections(
    text: string,
    sections: Record<string, string>,
  ): void {
    // Look for common prospectus headings
    const headings = [
      'Prospectus Summary',
      'Risk Factors',
      'Use of Proceeds',
      'Dilution',
      'Plan of Distribution',
    ];

    for (const heading of headings) {
      const pattern = new RegExp(heading + '([\\s\\S]{0,500})', 'i');
      const match = text.match(pattern);

      if (match) {
        sections[heading] = match[1].substring(0, 500).trim();
      }
    }
  }

  /**
   * Extract N-CEN sections (ETF annual report)
   */
  private extractNCENSections(
    text: string,
    sections: Record<string, string>,
  ): void {
    const headings = [
      'Authorized Participants',
      'Fund Structure',
      'Management Fees',
      'Total Annual Fund Operating Expenses',
      'Shareholder Fees',
      'Investment Objective',
      'Principal Investment Strategies',
    ];

    for (const heading of headings) {
      const pattern = new RegExp(heading + '([\\s\\S]{0,1000})', 'i');
      const match = text.match(pattern);
      if (match) {
        sections[heading] = match[1].substring(0, 1000).trim();
      }
    }
  }

  /**
   * Extract N-PORT sections (ETF quarterly holdings)
   */
  private extractNPORTSections(
    text: string,
    sections: Record<string, string>,
  ): void {
    const headings = [
      'Schedule of Portfolio Holdings',
      'Securities Lending',
      'Derivative Instruments',
      'Risk Metrics',
      'Explanatory Notes',
      'Percentage of Net Assets',
    ];

    for (const heading of headings) {
      const pattern = new RegExp(heading + '([\\s\\S]{0,1000})', 'i');
      const match = text.match(pattern);
      if (match) {
        sections[heading] = match[1].substring(0, 1000).trim();
      }
    }

    // N-PORT is often XML-based, detect holdings
    const xmlPattern = /<invstOrSec>[\s\S]*?<\/invstOrSec>/gi;
    const xmlMatches = text.match(xmlPattern);
    if (xmlMatches && xmlMatches.length > 0) {
      sections['XML_Holdings_Count'] = `${xmlMatches.length} holdings found`;
    }
  }

  /**
   * Extract exhibits from raw HTML
   */
  private extractExhibits(html: string): Record<string, string> {
    const exhibits: Record<string, string> = {};

    // Look for exhibit markers
    const exhibitPattern = /Exhibit\s+(\d+\.\d+)[:\s]+([^\n]+)/gi;
    let match;

    while ((match = exhibitPattern.exec(html)) !== null) {
      const exhibitNumber = match[1];
      const exhibitDescription = match[2].trim();
      exhibits[exhibitNumber] = exhibitDescription;
    }

    return exhibits;
  }
}
