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
   * Gracefully degrades if OpenSearch is unavailable.
   */
  async start(): Promise<void> {
    const logger = getLogger();

    if (this.isRunning) {
      logger.warn('Search indexer is already running');
      return;
    }

    try {
      logger.info('🔍 Starting search indexer job...');

      // Check if OpenSearch is available
      if (!esClient.isAvailable()) {
        const error = esClient.getInitializationError();
        logger.warn(
          { error },
          'OpenSearch is unavailable - search indexer running in degraded mode (indexing disabled)'
        );
        this.isRunning = true;
        return;
      }

      // Verify Elasticsearch connection
      const isConnected = await esClient.ping();
      if (!isConnected) {
        logger.warn('OpenSearch ping failed - search indexer running in degraded mode (indexing disabled)');
        this.isRunning = true;
        return;
      }

      logger.info('✅ OpenSearch connection verified');

      // Initialize index (idempotent)
      await this.indexManager.initializeIndex();

      // Perform full initial indexing
      logger.info('Starting initial full indexing...');
      await this.indexer.indexAllMarkets();
      await this.indexer.indexAllInstruments();
      await this.indexer.indexAllSignals();

      // Refresh index to make all documents searchable
      await this.indexManager.refreshIndex();

      logger.info('✅ Search indexer initialization complete');
      this.isRunning = true;
    } catch (error) {
      logger.warn(
        { error },
        'Search indexer failed to initialize - running in degraded mode (indexing disabled)'
      );
      // Don't throw - allow the service to run in degraded mode
      this.isRunning = true;
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
      logger.error({ error, marketId }, `Failed to incrementally index market ${marketId}`);
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
      logger.error({ error, instrumentId }, `Failed to incrementally index instrument ${instrumentId}`);
    }
  }

  /**
   * Index a single signal (for incremental updates).
   */
  async indexSignal(signalId: string): Promise<void> {
    try {
      await this.indexer.indexSignal(signalId);
    } catch (error) {
      const logger = getLogger();
      logger.error({ error, signalId }, `Failed to incrementally index signal ${signalId}`);
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
      logger.error({ error, entityId }, `Failed to delete document ${entityId}`);
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
