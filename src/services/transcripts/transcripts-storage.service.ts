import fs from 'fs/promises';
import path from 'path';
import { TranscriptsStorage } from './storage.interface.js';
import { getEnvironment } from '../../config/environment.js';
import { getLogger } from '../../utils/logger.js';

/**
 * Local filesystem storage for earnings call transcripts
 *
 * Path structure: {TRANSCRIPTS_STORAGE_PATH}/{symbol}/{transcript_id}.txt
 * Example: ./storage/transcripts/AAPL/fmp-transcript-AAPL-2024-Q2.txt
 */
export class TranscriptsStorageService implements TranscriptsStorage {
  private logger;
  private basePath: string;

  constructor() {
    this.logger = getLogger();
    const env = getEnvironment();
    this.basePath = env.TRANSCRIPTS_STORAGE_PATH;
  }

  /**
   * Initialize storage directory
   */
  async init(): Promise<void> {
    try {
      await fs.mkdir(this.basePath, { recursive: true });
      this.logger.info({ path: this.basePath }, 'Transcripts storage initialized');
    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize transcripts storage');
      throw error;
    }
  }

  /**
   * Store transcript text
   *
   * @param symbol Stock ticker (e.g., "AAPL", "TSLA")
   * @param transcriptId Transcript identifier (e.g., "fmp-transcript-AAPL-2024-Q2")
   * @param content Transcript text content
   * @returns Storage path (relative to base)
   */
  async store(
    symbol: string,
    transcriptId: string,
    content: string,
  ): Promise<string> {
    const relativePath = `${symbol}/${transcriptId}.txt`;
    const fullPath = path.join(this.basePath, relativePath);

    // Create symbol directory if needed
    const symbolDir = path.join(this.basePath, symbol);
    await fs.mkdir(symbolDir, { recursive: true });

    // Write content
    await fs.writeFile(fullPath, content, 'utf-8');

    this.logger.debug({ path: relativePath }, 'Transcript stored');
    return relativePath;
  }

  /**
   * Retrieve transcript content
   *
   * @param storagePath Relative storage path
   * @returns Transcript text content
   */
  async retrieve(storagePath: string): Promise<string> {
    const fullPath = path.join(this.basePath, storagePath);
    const content = await fs.readFile(fullPath, 'utf-8');
    return content;
  }

  /**
   * Check if transcript exists
   *
   * @param storagePath Relative storage path
   * @returns True if file exists
   */
  async exists(storagePath: string): Promise<boolean> {
    try {
      const fullPath = path.join(this.basePath, storagePath);
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete transcript
   *
   * @param storagePath Relative storage path
   */
  async delete(storagePath: string): Promise<void> {
    const fullPath = path.join(this.basePath, storagePath);
    await fs.unlink(fullPath);
    this.logger.debug({ path: storagePath }, 'Transcript deleted');
  }
}
