import { IndexManagerService } from '../services/search/index-manager.service.js';
import { SearchIndexerService } from '../services/search/search-indexer.service.js';
import { esClient } from '../services/search/elasticsearch.client.js';
import { getLogger } from '../utils/logger.js';

/**
 * Search indexer background job.
 * Initializes the search index and provides methods for incremental indexing.
 */
export class SearchIndexerJob {
  private indexManager: IndexManagerService;
  private indexer: SearchIndexerService;
  private isRunning: boolean = false;

  constructor() {
    this.indexManager = new IndexManagerService();
    this.indexer = new SearchIndexerService();
  }

  /**
   * Start the search indexer.
   * Initializes the index and performs a full initial index.
   */
  async start(): Promise<void> {
    const logger = getLogger();

    if (this.isRunning) {
      logger.warn('Search indexer is already running');
      return;
    }

    this.isRunning = true;

    try {
      logger.info('🔍 Starting search indexer job...');

      // Verify Elasticsearch connection
      const isConnected = await esClient.ping();
      if (!isConnected) {
        throw new Error('Failed to connect to Elasticsearch');
      }

      logger.info('✅ Elasticsearch connection verified');

      // Initialize index (idempotent)
      await this.indexManager.initializeIndex();

      // Perform full initial indexing
      logger.info('Starting initial full indexing...');
      await this.indexer.indexAllMarkets();
      await this.indexer.indexAllInstruments();

      // Refresh index to make all documents searchable
      await this.indexManager.refreshIndex();

      logger.info('✅ Search indexer initialization complete');
    } catch (error) {
      logger.error('Failed to start search indexer:', error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Index a single market (for incremental updates).
   */
  async indexMarket(marketId: string): Promise<void> {
    try {
      await this.indexer.indexMarket(marketId);
    } catch (error) {
      const logger = getLogger();
      logger.error(`Failed to incrementally index market ${marketId}:`, error);
    }
  }

  /**
   * Index a single instrument (for incremental updates).
   */
  async indexInstrument(instrumentId: string): Promise<void> {
    try {
      await this.indexer.indexInstrument(instrumentId);
    } catch (error) {
      const logger = getLogger();
      logger.error(`Failed to incrementally index instrument ${instrumentId}:`, error);
    }
  }

  /**
   * Delete a document from the index.
   */
  async deleteDocument(entityId: string): Promise<void> {
    try {
      await this.indexer.deleteDocument(entityId);
    } catch (error) {
      const logger = getLogger();
      logger.error(`Failed to delete document ${entityId}:`, error);
    }
  }

  /**
   * Stop the search indexer.
   */
  stop(): void {
    this.isRunning = false;
    const logger = getLogger();
    logger.info('Search indexer job stopped');
  }

  /**
   * Check if the indexer is running.
   */
  isIndexerRunning(): boolean {
    return this.isRunning;
  }
}
