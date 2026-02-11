/**
 * Swappable storage interface for news articles
 * Allows switching between local filesystem and cloud storage (S3, etc.)
 */
export interface NewsStorage {
  /**
   * Initialize storage (create directories, test connectivity, etc.)
   */
  init(): Promise<void>;

  /**
   * Store news article text
   * @param publisherSlug Publisher identifier (e.g., "reuters", "bloomberg")
   * @param articleId Article identifier (e.g., "finnhub-12345")
   * @param content Article text content
   * @returns Storage path (relative to base)
   */
  store(publisherSlug: string, articleId: string, content: string): Promise<string>;

  /**
   * Retrieve article content
   * @param storagePath Relative storage path
   * @returns Article text content
   */
  retrieve(storagePath: string): Promise<string>;

  /**
   * Check if article exists
   * @param storagePath Relative storage path
   * @returns True if file exists
   */
  exists(storagePath: string): Promise<boolean>;

  /**
   * Delete article
   * @param storagePath Relative storage path
   */
  delete(storagePath: string): Promise<void>;
}
