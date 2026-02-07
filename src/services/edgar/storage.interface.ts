/**
 * Swappable storage interface for SEC EDGAR filings
 * Allows switching between local filesystem and cloud storage (S3, etc.)
 */
export interface FilingStorage {
  /**
   * Save filing content to storage
   * @param path - Relative path within storage (e.g., "1234567890/0001234567-21-000123.html")
   * @param content - Raw filing content
   */
  save(path: string, content: Buffer): Promise<void>;

  /**
   * Read filing content from storage
   * @param path - Relative path within storage
   * @returns Filing content as Buffer
   */
  read(path: string): Promise<Buffer>;

  /**
   * Check if filing exists in storage
   * @param path - Relative path within storage
   * @returns True if file exists
   */
  exists(path: string): Promise<boolean>;

  /**
   * Delete filing from storage
   * @param path - Relative path within storage
   */
  delete(path: string): Promise<void>;
}
