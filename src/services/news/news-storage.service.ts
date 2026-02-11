import fs from 'fs/promises';
import path from 'path';
import { NewsStorage } from './storage.interface.js';
import { getEnvironment } from '../../config/environment.js';
import { getLogger } from '../../utils/logger.js';

/**
 * Local filesystem storage for news articles
 *
 * Path structure: {NEWS_STORAGE_PATH}/{publisher_slug}/{article_id}.txt
 * Example: ./storage/news/reuters/finnhub-12345.txt
 */
export class NewsStorageService implements NewsStorage {
  private logger;
  private basePath: string;

  constructor() {
    this.logger = getLogger();
    const env = getEnvironment();
    this.basePath = env.NEWS_STORAGE_PATH;
  }

  /**
   * Initialize storage directory
   */
  async init(): Promise<void> {
    try {
      await fs.mkdir(this.basePath, { recursive: true });
      this.logger.info({ path: this.basePath }, 'News storage initialized');
    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize news storage');
      throw error;
    }
  }

  /**
   * Store news article text
   *
   * @param publisherSlug Publisher identifier (e.g., "reuters", "bloomberg")
   * @param articleId Article identifier (e.g., "finnhub-12345")
   * @param content Article text content
   * @returns Storage path (relative to base)
   */
  async store(
    publisherSlug: string,
    articleId: string,
    content: string,
  ): Promise<string> {
    const relativePath = `${publisherSlug}/${articleId}.txt`;
    const fullPath = path.join(this.basePath, relativePath);

    // Create publisher directory if needed
    const publisherDir = path.join(this.basePath, publisherSlug);
    await fs.mkdir(publisherDir, { recursive: true });

    // Write content
    await fs.writeFile(fullPath, content, 'utf-8');

    this.logger.debug({ path: relativePath }, 'Article stored');
    return relativePath;
  }

  /**
   * Retrieve article content
   *
   * @param storagePath Relative storage path
   * @returns Article text content
   */
  async retrieve(storagePath: string): Promise<string> {
    const fullPath = path.join(this.basePath, storagePath);
    const content = await fs.readFile(fullPath, 'utf-8');
    return content;
  }

  /**
   * Check if article exists
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
   * Delete article
   *
   * @param storagePath Relative storage path
   */
  async delete(storagePath: string): Promise<void> {
    const fullPath = path.join(this.basePath, storagePath);
    await fs.unlink(fullPath);
    this.logger.debug({ path: storagePath }, 'Article deleted');
  }
}
