import { Client } from '@elastic/elasticsearch';
import { getEnvironment } from '../../config/environment.js';
import { getLogger } from '../../utils/logger.js';

/**
 * Singleton Elasticsearch client for the trading terminal.
 * Provides centralized access to the search cluster.
 */
class ElasticsearchClient {
  private static instance: ElasticsearchClient | null = null;
  private client: Client | null = null;
  private indexPrefix: string = '';

  private constructor() {
    // Lazy initialization - client is created when first method is called
  }

  /**
   * Get the singleton instance of the Elasticsearch client.
   */
  static getInstance(): ElasticsearchClient {
    if (!ElasticsearchClient.instance) {
      ElasticsearchClient.instance = new ElasticsearchClient();
    }
    return ElasticsearchClient.instance;
  }

  /**
   * Initialize the Elasticsearch client (called lazily on first use).
   */
  private ensureInitialized(): void {
    if (this.client) {
      return; // Already initialized
    }

    const env = getEnvironment();

    this.client = new Client({
      node: env.ELASTICSEARCH_URL,
      maxRetries: 3,
      requestTimeout: 30000,
    });

    this.indexPrefix = env.ELASTICSEARCH_INDEX_PREFIX;

    const logger = getLogger();
    logger.info(`Elasticsearch client initialized: ${env.ELASTICSEARCH_URL}`);
  }

  /**
   * Get the underlying Elasticsearch client.
   */
  getClient(): Client {
    this.ensureInitialized();
    return this.client!;
  }

  /**
   * Get the full index name with prefix.
   */
  getIndexName(suffix: string): string {
    this.ensureInitialized();
    return `${this.indexPrefix}${suffix}`;
  }

  /**
   * Ping the Elasticsearch cluster to verify connection.
   */
  async ping(): Promise<boolean> {
    try {
      this.ensureInitialized();
      await this.client!.ping();
      return true;
    } catch (error) {
      const logger = getLogger();
      logger.error({ error }, 'Elasticsearch ping failed');
      return false;
    }
  }

  /**
   * Get cluster health status.
   */
  async getHealth(): Promise<any> {
    try {
      this.ensureInitialized();
      const health = await this.client!.cluster.health();
      return health;
    } catch (error) {
      const logger = getLogger();
      logger.error({ error }, 'Failed to get Elasticsearch cluster health');
      throw error;
    }
  }

  /**
   * Close the Elasticsearch connection.
   */
  async close(): Promise<void> {
    try {
      if (!this.client) {
        return; // Not initialized, nothing to close
      }
      await this.client.close();
      const logger = getLogger();
      logger.info('Elasticsearch client closed');
    } catch (error) {
      const logger = getLogger();
      logger.error({ error }, 'Error closing Elasticsearch client');
      throw error;
    }
  }
}

export const esClient = ElasticsearchClient.getInstance();
