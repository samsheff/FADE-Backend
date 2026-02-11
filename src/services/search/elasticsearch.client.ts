import { Client } from '@opensearch-project/opensearch';
import { getEnvironment } from '../../config/environment.js';
import { getLogger } from '../../utils/logger.js';

/**
 * Singleton OpenSearch client for the trading terminal.
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
   * Get the singleton instance of the OpenSearch client.
   */
  static getInstance(): ElasticsearchClient {
    if (!ElasticsearchClient.instance) {
      ElasticsearchClient.instance = new ElasticsearchClient();
    }
    return ElasticsearchClient.instance;
  }

  /**
   * Initialize the OpenSearch client (called lazily on first use).
   */
  private ensureInitialized(): void {
    if (this.client) {
      return; // Already initialized
    }

    const env = getEnvironment();

    // Parse the OpenSearch URL to extract credentials
    const url = new URL(env.ELASTICSEARCH_URL);

    this.client = new Client({
      node: env.ELASTICSEARCH_URL,
      ssl: {
        rejectUnauthorized: true,
      },
    });

    this.indexPrefix = env.ELASTICSEARCH_INDEX_PREFIX;

    const logger = getLogger();
    logger.info(`OpenSearch client initialized: ${url.host}`);
  }

  /**
   * Get the underlying OpenSearch client.
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
   * Ping the OpenSearch cluster to verify connection.
   */
  async ping(): Promise<boolean> {
    try {
      this.ensureInitialized();
      await this.client!.ping();
      return true;
    } catch (error) {
      const logger = getLogger();
      logger.error({ error }, 'OpenSearch ping failed');
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
      logger.error({ error }, 'Failed to get OpenSearch cluster health');
      throw error;
    }
  }

  /**
   * Close the OpenSearch connection.
   */
  async close(): Promise<void> {
    try {
      if (!this.client) {
        return; // Not initialized, nothing to close
      }
      await this.client.close();
      const logger = getLogger();
      logger.info('OpenSearch client closed');
    } catch (error) {
      const logger = getLogger();
      logger.error({ error }, 'Error closing OpenSearch client');
      throw error;
    }
  }
}

export const esClient = ElasticsearchClient.getInstance();
