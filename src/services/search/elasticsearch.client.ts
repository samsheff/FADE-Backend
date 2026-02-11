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
  private available: boolean = false;
  private initializationError: Error | null = null;

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
   * Gracefully handles errors to allow service degradation.
   */
  private ensureInitialized(): void {
    if (this.client) {
      return; // Already initialized
    }

    const logger = getLogger();
    const env = getEnvironment();

    try {
      // Parse the OpenSearch URL to extract credentials
      const url = new URL(env.ELASTICSEARCH_URL);

      this.client = new Client({
        node: env.ELASTICSEARCH_URL,
        ssl: {
          rejectUnauthorized: true,
        },
      });

      this.indexPrefix = env.ELASTICSEARCH_INDEX_PREFIX;
      this.available = true;

      logger.info(`OpenSearch client initialized: ${url.host}`);
    } catch (error) {
      this.available = false;
      this.initializationError = error as Error;

      // Log detailed diagnostic information
      if (error instanceof TypeError && (error.message.includes('Invalid URL') || error.message.includes('Failed to construct'))) {
        logger.warn({ url: env.ELASTICSEARCH_URL }, 'OpenSearch URL is malformed - search indexing disabled');
      } else if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
        logger.warn({ url: env.ELASTICSEARCH_URL }, 'OpenSearch server connection refused - search indexing disabled');
      } else if (error instanceof Error && error.message.includes('ENOTFOUND')) {
        logger.warn({ url: env.ELASTICSEARCH_URL }, 'OpenSearch hostname not found - search indexing disabled');
      } else {
        logger.warn({ error }, 'OpenSearch initialization failed - search indexing disabled');
      }
    }
  }

  /**
   * Check if OpenSearch is available.
   */
  isAvailable(): boolean {
    this.ensureInitialized();
    return this.available;
  }

  /**
   * Get the initialization error if available.
   */
  getInitializationError(): Error | null {
    return this.initializationError;
  }

  /**
   * Get the underlying OpenSearch client.
   * Throws if client is not available.
   */
  getClient(): Client {
    this.ensureInitialized();
    if (!this.available || !this.client) {
      throw new Error('OpenSearch client is not available');
    }
    return this.client;
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
