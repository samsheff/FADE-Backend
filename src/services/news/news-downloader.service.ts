import axios from 'axios';
import crypto from 'crypto';
import { DocumentRepository } from '../../adapters/database/repositories/document.repository.js';
import { NewsStorageService } from './news-storage.service.js';
import { getLogger } from '../../utils/logger.js';
import { DocumentRecord } from '../../types/document.types.js';

/**
 * News Downloader Service
 *
 * Fetches full article content from source URLs and stores in object storage.
 *
 * Pipeline:
 * PENDING → DOWNLOADING → DOWNLOADED (with storagePath, contentHash)
 * PENDING → DOWNLOADING → FAILED (with errorMessage)
 *
 * Responsibilities:
 * - Fetch article content via HTTP
 * - Extract clean text from HTML
 * - Compute SHA256 content hash
 * - Store in NewsStorageService
 * - Update Document status
 */
export class NewsDownloaderService {
  private documentRepo: DocumentRepository;
  private storage: NewsStorageService;
  private logger;

  constructor() {
    this.documentRepo = new DocumentRepository();
    this.storage = new NewsStorageService();
    this.logger = getLogger();
  }

  /**
   * Initialize storage
   */
  async init(): Promise<void> {
    await this.storage.init();
  }

  /**
   * Process pending articles (batch)
   *
   * @param batchSize Number of articles to process
   * @returns Number of articles successfully downloaded
   */
  async processPendingArticles(batchSize: number): Promise<number> {
    const pending = await this.documentRepo.findByStatusAndType(
      'PENDING',
      'NEWS_ARTICLE',
      batchSize,
    );

    if (pending.length === 0) {
      return 0;
    }

    this.logger.info(
      { count: pending.length },
      'Processing pending news articles',
    );

    let successCount = 0;

    for (const document of pending) {
      try {
        await this.downloadArticle(document);
        successCount++;
      } catch (error) {
        this.logger.error(
          { error, documentId: document.id },
          'Failed to download article',
        );
        // Error handling is done inside downloadArticle
      }
    }

    this.logger.info(
      { total: pending.length, success: successCount },
      'Completed article download batch',
    );

    return successCount;
  }

  /**
   * Download single article
   *
   * @param document Document record
   */
  private async downloadArticle(document: DocumentRecord): Promise<void> {
    if (!document.sourceUrl) {
      this.logger.warn(
        { documentId: document.id },
        'Article has no source URL, marking as failed',
      );
      await this.documentRepo.updateStatus(document.id, 'FAILED', {
        errorMessage: 'No source URL',
      });
      return;
    }

    try {
      // Update status to DOWNLOADING
      await this.documentRepo.updateStatus(document.id, 'DOWNLOADING');

      this.logger.debug(
        { documentId: document.id, url: document.sourceUrl },
        'Downloading article content',
      );

      // Fetch article content
      const response = await axios.get(document.sourceUrl, {
        timeout: 30000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; TradingTerminal/1.0; +https://example.com)',
        },
        validateStatus: (status) => status < 500, // Accept 4xx but not 5xx
      });

      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = response.data;

      // Extract text content
      const text = this.extractArticleText(html);

      if (!text || text.length < 50) {
        throw new Error('Extracted text too short or empty');
      }

      // Compute content hash
      const contentHash = crypto
        .createHash('sha256')
        .update(text)
        .digest('hex');

      // Generate storage path
      const metadata = document.metadata as any;
      const publisherSlug = this.slugify(metadata?.source || 'unknown');
      const articleId = document.sourceId;

      // Store article
      const storagePath = await this.storage.store(
        publisherSlug,
        articleId,
        text,
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
          storagePath,
          contentLength: text.length,
        },
        'Article downloaded successfully',
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        { error, documentId: document.id },
        'Article download failed',
      );

      await this.documentRepo.updateStatus(document.id, 'FAILED', {
        errorMessage,
      });
    }
  }

  /**
   * Extract clean text from HTML
   *
   * Simple implementation: strip HTML tags, decode entities, clean whitespace
   *
   * @param html Raw HTML content
   * @returns Clean text
   */
  private extractArticleText(html: string): string {
    if (typeof html !== 'string') {
      return '';
    }

    // Remove script and style tags
    let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, ' ');

    // Decode common HTML entities
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");

    // Clean whitespace
    text = text.replace(/\s+/g, ' '); // Collapse whitespace
    text = text.trim();

    return text;
  }

  /**
   * Convert string to URL-safe slug
   *
   * @param str Input string
   * @returns Slugified string
   */
  private slugify(str: string): string {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
