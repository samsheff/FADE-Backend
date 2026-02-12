import crypto from 'crypto';
import { DocumentRepository } from '../../adapters/database/repositories/document.repository.js';
import { FmpTranscriptsApiAdapter } from '../../adapters/transcripts/fmp-transcripts-api.adapter.js';
import { TranscriptsStorage } from './storage.interface.js';
import { createTranscriptsStorage } from './storage.factory.js';
import { getLogger } from '../../utils/logger.js';
import { DocumentRecord } from '../../types/document.types.js';

/**
 * Transcripts Downloader Service
 *
 * Fetches full transcript content from FMP API and stores in object storage.
 *
 * Pipeline:
 * PENDING → DOWNLOADING → DOWNLOADED (with storagePath, contentHash)
 * PENDING → DOWNLOADING → FAILED (with errorMessage)
 *
 * Responsibilities:
 * - Fetch transcript content via FMP API
 * - Compute SHA256 content hash
 * - Store in TranscriptsStorage
 * - Update Document status
 */
export class TranscriptsDownloaderService {
  private documentRepo: DocumentRepository;
  private fmp: FmpTranscriptsApiAdapter;
  private storage: TranscriptsStorage;
  private logger;

  constructor(storage?: TranscriptsStorage) {
    this.documentRepo = new DocumentRepository();
    this.fmp = new FmpTranscriptsApiAdapter();
    this.storage = storage || createTranscriptsStorage();
    this.logger = getLogger();
  }

  /**
   * Initialize storage
   */
  async init(): Promise<void> {
    await this.storage.init();
  }

  /**
   * Process pending transcripts (batch)
   *
   * @param batchSize Number of transcripts to process
   * @returns Number of transcripts successfully downloaded
   */
  async processPendingTranscripts(batchSize: number): Promise<number> {
    const pending = await this.documentRepo.findByStatusAndType(
      'PENDING',
      'EARNINGS_TRANSCRIPT',
      batchSize,
    );

    if (pending.length === 0) {
      return 0;
    }

    this.logger.info(
      { count: pending.length },
      'Processing pending transcripts',
    );

    let successCount = 0;

    for (const document of pending) {
      try {
        await this.downloadTranscript(document);
        successCount++;
      } catch (error) {
        this.logger.error(
          { err: error, documentId: document.id, phase: 'DOWNLOAD' },
          'Failed to download transcript',
        );
        // Error handling is done inside downloadTranscript
      }
    }

    this.logger.info(
      { total: pending.length, success: successCount },
      'Completed transcript download batch',
    );

    return successCount;
  }

  /**
   * Download single transcript
   *
   * @param document Document record
   */
  private async downloadTranscript(document: DocumentRecord): Promise<void> {
    // Extract ticker, year, quarter from metadata
    const metadata = document.metadata as any;
    const symbol = metadata?.symbol;
    const year = metadata?.fiscalYear;
    const quarter = metadata?.quarter;

    if (!symbol || !year || !quarter) {
      this.logger.warn(
        { documentId: document.id, metadata },
        'Transcript missing required metadata (symbol/year/quarter), marking as failed',
      );
      await this.documentRepo.updateStatus(document.id, 'FAILED', {
        errorMessage: 'Missing symbol, year, or quarter in metadata',
      });
      return;
    }

    try {
      // Update status to DOWNLOADING
      await this.documentRepo.updateStatus(document.id, 'DOWNLOADING');

      this.logger.debug(
        { documentId: document.id, symbol, year, quarter },
        'Downloading transcript content',
      );

      // Fetch transcript content from FMP API
      const transcript = await this.fmp.getTranscript(symbol, year, quarter);

      if (!transcript || !transcript.content) {
        throw new Error('Transcript content not found or empty');
      }

      const content = transcript.content.trim();

      if (content.length < 100) {
        throw new Error('Transcript content too short (< 100 chars)');
      }

      // Compute content hash
      const contentHash = crypto
        .createHash('sha256')
        .update(content)
        .digest('hex');

      // Generate storage path
      const transcriptId = document.sourceId; // e.g., fmp-transcript-AAPL-2024-Q2

      // Store transcript
      const storagePath = await this.storage.store(
        symbol,
        transcriptId,
        content,
      );

      // Update status to DOWNLOADED
      await this.documentRepo.updateStatus(document.id, 'DOWNLOADED', {
        storagePath,
        contentHash,
        downloadedAt: new Date(),
      });

      this.logger.info(
        {
          documentId: document.id,
          symbol,
          year,
          quarter,
          storagePath,
          contentLength: content.length,
        },
        'Transcript downloaded successfully',
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        { err: error, documentId: document.id, symbol, year, quarter },
        'Transcript download failed',
      );

      await this.documentRepo.updateStatus(document.id, 'FAILED', {
        errorMessage,
      });
    }
  }
}
