import * as crypto from 'crypto';
import { EdgarApiAdapter } from '../../adapters/edgar/edgar-api.adapter.js';
import { FilingRepository } from '../../adapters/database/repositories/filing.repository.js';
import { FilingStorage } from './storage.interface.js';
import { createFilingStorage } from './storage.factory.js';
import { getLogger } from '../../utils/logger.js';

/**
 * Filing Downloader Service
 * Downloads PENDING filings from SEC EDGAR to local storage
 */
export class FilingDownloaderService {
  private edgarApi: EdgarApiAdapter;
  private filingRepo: FilingRepository;
  private storage: FilingStorage;
  private logger;

  constructor(storage?: FilingStorage) {
    this.edgarApi = new EdgarApiAdapter();
    this.filingRepo = new FilingRepository();
    this.storage = storage || createFilingStorage();
    this.logger = getLogger();
  }

  /**
   * Process PENDING filings and download them
   * @param limit - Maximum number of filings to process in this batch
   * @returns Number of filings successfully downloaded
   */
  async processPendingFilings(limit = 10): Promise<number> {
    this.logger.info({ limit }, 'Processing pending filings');

    const pending = await this.filingRepo.findByStatus('PENDING', limit);

    if (pending.length === 0) {
      this.logger.debug('No pending filings to download');
      return 0;
    }

    let successCount = 0;

    for (const filing of pending) {
      try {
        // Update status to DOWNLOADING
        await this.filingRepo.updateStatus(filing.id, 'DOWNLOADING');

        // Download filing content
        const content = await this.edgarApi.downloadFiling(
          filing.accessionNumber,
          filing.cik,
        );

        // Compute content hash
        const hash = this.computeHash(content);

        // Build storage path: {cik}/{accession_number}.html
        const storagePath = this.buildStoragePath(
          filing.cik,
          filing.accessionNumber,
        );

        // Save to storage
        await this.storage.save(storagePath, content);

        // Update filing status
        await this.filingRepo.updateStatus(filing.id, 'DOWNLOADED', {
          storagePath,
          contentHash: hash,
          downloadedAt: new Date(),
        });

        this.logger.info(
          {
            filingId: filing.id,
            accessionNumber: filing.accessionNumber,
            size: content.length,
          },
          'Downloaded filing',
        );

        successCount++;
      } catch (error) {
        this.logger.error(
          {
            filingId: filing.id,
            accessionNumber: filing.accessionNumber,
            error,
          },
          'Failed to download filing',
        );

        // Update status to FAILED
        await this.filingRepo.updateStatus(filing.id, 'FAILED', {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.info(
      { total: pending.length, success: successCount },
      'Completed downloading batch',
    );

    return successCount;
  }

  /**
   * Compute SHA256 hash of content
   */
  private computeHash(content: Buffer): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Build storage path for filing
   * Format: {cik}/{accession_number}.html
   */
  private buildStoragePath(cik: string, accessionNumber: string): string {
    return `${cik}/${accessionNumber}.html`;
  }
}
