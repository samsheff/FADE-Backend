import { DocumentRepository } from '../../adapters/database/repositories/document.repository.js';
import { TranscriptsStorage } from './storage.interface.js';
import { createTranscriptsStorage } from './storage.factory.js';
import { getLogger } from '../../utils/logger.js';
import { DocumentRecord } from '../../types/document.types.js';
import { ParsedTranscript } from '../../types/transcripts.types.js';

/**
 * Transcripts Parser Service
 *
 * Parses earnings call transcripts into structured sections and extracts speaker metadata.
 *
 * Pipeline:
 * DOWNLOADED → PARSING → PARSED (with DocumentContent.structured)
 * DOWNLOADED → PARSING → FAILED (with errorMessage)
 *
 * Responsibilities:
 * - Split transcript into sections (prepared remarks, Q&A)
 * - Identify speakers and normalize titles (CEO, CFO, etc.)
 * - Compute word counts and metadata
 * - Store structured data in DocumentContent table
 */
export class TranscriptsParserService {
  private documentRepo: DocumentRepository;
  private storage: TranscriptsStorage;
  private logger;

  // Regex patterns for Q&A session detection
  private readonly QA_MARKERS = [
    /question-and-answer/i,
    /Q&A\s+session/i,
    /Q&A/i,
    /questions?\s+and\s+answers?/i,
    /operator:\s*(?:we|thank|if you|ladies and gentlemen, at this time)/i,
    /conference call participants/i,
  ];

  // Speaker title normalization patterns
  private readonly TITLE_PATTERNS = [
    { pattern: /chief executive officer|ceo/i, normalized: 'CEO' },
    { pattern: /chief financial officer|cfo/i, normalized: 'CFO' },
    { pattern: /chief operating officer|coo/i, normalized: 'COO' },
    { pattern: /chief technology officer|cto/i, normalized: 'CTO' },
    { pattern: /president/i, normalized: 'President' },
    { pattern: /chairman/i, normalized: 'Chairman' },
    { pattern: /analyst|equity research/i, normalized: 'Analyst' },
    { pattern: /operator/i, normalized: 'Operator' },
  ];

  constructor(storage?: TranscriptsStorage) {
    this.documentRepo = new DocumentRepository();
    this.storage = storage || createTranscriptsStorage();
    this.logger = getLogger();
  }

  /**
   * Process downloaded transcripts (batch)
   *
   * @param batchSize Number of transcripts to process
   * @returns Number of transcripts successfully parsed
   */
  async processDownloadedTranscripts(batchSize: number): Promise<number> {
    const downloaded = await this.documentRepo.findByStatusAndType(
      'DOWNLOADED',
      'EARNINGS_TRANSCRIPT',
      batchSize,
    );

    if (downloaded.length === 0) {
      return 0;
    }

    this.logger.info(
      { count: downloaded.length },
      'Processing downloaded transcripts',
    );

    let successCount = 0;

    for (const document of downloaded) {
      try {
        await this.parseTranscript(document);
        successCount++;
      } catch (error) {
        this.logger.error(
          { err: error, documentId: document.id, phase: 'PARSE' },
          'Failed to parse transcript',
        );
        // Error handling is done inside parseTranscript
      }
    }

    this.logger.info(
      { total: downloaded.length, success: successCount },
      'Completed transcript parsing batch',
    );

    return successCount;
  }

  /**
   * Parse single transcript
   *
   * @param document Document record
   */
  private async parseTranscript(document: DocumentRecord): Promise<void> {
    if (!document.storagePath) {
      this.logger.warn(
        { documentId: document.id },
        'Transcript has no storage path, marking as failed',
      );
      await this.documentRepo.updateStatus(document.id, 'FAILED', {
        errorMessage: 'No storage path',
      });
      return;
    }

    try {
      // Update status to PARSING
      await this.documentRepo.updateStatus(document.id, 'PARSING');

      this.logger.debug(
        { documentId: document.id, storagePath: document.storagePath },
        'Parsing transcript',
      );

      // Retrieve transcript content
      const content = await this.storage.retrieve(document.storagePath);

      // Parse sections
      const sections = this.splitSections(content);

      // Identify speakers
      const speakers = this.identifySpeakers(content);

      // Compute metadata
      const preparedRemarksWordCount = this.countWords(sections.preparedRemarks);
      const qaSessionWordCount = this.countWords(sections.qaSession);
      const totalWordCount = preparedRemarksWordCount + qaSessionWordCount;
      const qaRatio = totalWordCount > 0 ? qaSessionWordCount / totalWordCount : 0;

      // Build structured data
      const structured: ParsedTranscript = {
        sections: {
          preparedRemarks: {
            text: sections.preparedRemarks,
            wordCount: preparedRemarksWordCount,
          },
          qaSession: {
            text: sections.qaSession,
            wordCount: qaSessionWordCount,
          },
        },
        speakers,
        metadata: {
          totalWordCount,
          qaRatio: Math.round(qaRatio * 100) / 100, // Round to 2 decimal places
        },
      };

      // Store structured data
      await this.documentRepo.createContent({
        documentId: document.id,
        fullText: content,
        wordCount: totalWordCount,
        structured,
      });

      // Update status to PARSED
      await this.documentRepo.updateStatus(document.id, 'PARSED', {
        parsedAt: new Date(),
      });

      this.logger.info(
        {
          documentId: document.id,
          totalWordCount,
          qaRatio: structured.metadata.qaRatio,
          speakerCount: Object.keys(speakers).length,
        },
        'Transcript parsed successfully',
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        { err: error, documentId: document.id },
        'Transcript parsing failed',
      );

      await this.documentRepo.updateStatus(document.id, 'FAILED', {
        errorMessage,
      });
    }
  }

  /**
   * Split transcript into sections
   *
   * @param content Full transcript text
   * @returns Sections object with prepared remarks and Q&A
   */
  private splitSections(content: string): {
    preparedRemarks: string;
    qaSession: string;
  } {
    // Find Q&A session start
    let qaStartIndex = -1;

    for (const pattern of this.QA_MARKERS) {
      const match = content.match(pattern);
      if (match && match.index !== undefined) {
        qaStartIndex = match.index;
        break;
      }
    }

    if (qaStartIndex === -1) {
      // No Q&A marker found - treat entire transcript as prepared remarks
      this.logger.debug('No Q&A marker found, treating entire transcript as prepared remarks');
      return {
        preparedRemarks: content.trim(),
        qaSession: '',
      };
    }

    // Split at Q&A marker
    const preparedRemarks = content.substring(0, qaStartIndex).trim();
    const qaSession = content.substring(qaStartIndex).trim();

    return {
      preparedRemarks,
      qaSession,
    };
  }

  /**
   * Identify speakers and normalize their titles
   *
   * @param content Full transcript text
   * @returns Speaker map (name -> normalized title)
   */
  private identifySpeakers(content: string): Record<string, string> {
    const speakers: Record<string, string> = {};

    // Pattern: "John Smith -- Chief Executive Officer"
    // Pattern: "Jane Doe, Chief Financial Officer"
    // Pattern: "Bob Johnson - CEO"
    const speakerPattern = /([A-Z][a-z]+\s+[A-Z][a-z]+)\s*(?:--|,|-)\s*([^:\n]+)/g;

    let match;
    while ((match = speakerPattern.exec(content)) !== null) {
      const name = match[1].trim();
      const title = match[2].trim();

      if (!speakers[name]) {
        const normalizedTitle = this.normalizeTitle(title);
        speakers[name] = normalizedTitle;
      }
    }

    this.logger.debug(
      { speakerCount: Object.keys(speakers).length },
      'Identified speakers',
    );

    return speakers;
  }

  /**
   * Normalize executive title
   *
   * @param title Raw title from transcript
   * @returns Normalized title (e.g., "CEO", "CFO", "Analyst")
   */
  private normalizeTitle(title: string): string {
    for (const { pattern, normalized } of this.TITLE_PATTERNS) {
      if (pattern.test(title)) {
        return normalized;
      }
    }

    // If no pattern matches, return cleaned title (first 50 chars)
    return title.substring(0, 50).trim();
  }

  /**
   * Count words in text
   *
   * @param text Input text
   * @returns Word count
   */
  private countWords(text: string): number {
    if (!text) return 0;

    // Split on whitespace and filter out empty strings
    const words = text.trim().split(/\s+/).filter((word) => word.length > 0);
    return words.length;
  }
}
