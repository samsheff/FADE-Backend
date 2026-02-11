import { esClient } from './elasticsearch.client.js';
import { getLogger } from '../../utils/logger.js';

/**
 * Manages Elasticsearch index creation and configuration.
 * Handles schema definition, analyzer setup, and index lifecycle.
 */
export class IndexManagerService {
  private indexName: string | null = null;

  constructor() {
    // Lazy initialization
  }

  private ensureIndexName(): string {
    if (!this.indexName) {
      this.indexName = esClient.getIndexName('unified_search');
    }
    return this.indexName;
  }

  /**
   * Initialize the unified search index.
   * This method is idempotent - safe to call multiple times.
   */
  async initializeIndex(): Promise<void> {
    const client = esClient.getClient();
    const indexName = this.ensureIndexName();

    try {
      // Check if index already exists
      const exists = await client.indices.exists({ index: indexName });

      if (exists) {
        const logger = getLogger();
        logger.info(`Index ${indexName} already exists`);
        return;
      }

      // Create index with mappings and analyzers
      await client.indices.create({
        index: indexName,
        body: {
          settings: {
            number_of_shards: 1,
            number_of_replicas: 0,
            analysis: {
              analyzer: {
                autocomplete_analyzer: {
                  type: 'custom',
                  tokenizer: 'standard',
                  filter: ['lowercase', 'autocomplete_edge_ngram'],
                },
                symbol_analyzer: {
                  type: 'custom',
                  tokenizer: 'keyword',
                  filter: ['lowercase'],
                },
              },
              filter: {
                autocomplete_edge_ngram: {
                  type: 'edge_ngram',
                  min_gram: 2,
                  max_gram: 20,
                },
              },
            },
          },
          mappings: {
            properties: {
              entity_type: {
                type: 'keyword',
              },
              entity_id: {
                type: 'keyword',
              },
              primary_text: {
                type: 'text',
                analyzer: 'autocomplete_analyzer',
                search_analyzer: 'standard',
                fields: {
                  exact: {
                    type: 'keyword',
                  },
                },
              },
              secondary_text: {
                type: 'text',
                analyzer: 'standard',
              },
              symbol: {
                type: 'text',
                analyzer: 'symbol_analyzer',
                fields: {
                  exact: {
                    type: 'keyword',
                  },
                },
              },
              category: {
                type: 'keyword',
              },
              tags: {
                type: 'keyword',
              },
              has_signals: {
                type: 'boolean',
              },
              signal_count: {
                type: 'integer',
              },
              is_active: {
                type: 'boolean',
              },
              liquidity: {
                type: 'float',
              },
              volume: {
                type: 'float',
              },
              last_updated: {
                type: 'date',
              },
              metadata: {
                type: 'object',
                enabled: false,
              },
              signal_type: {
                type: 'keyword',
              },
              signal_severity: {
                type: 'keyword',
              },
              signal_score: {
                type: 'float',
              },
              instrument_id: {
                type: 'keyword',
              },
            },
          },
        },
      });

      const logger = getLogger();
      logger.info(`Created index ${indexName} with autocomplete mappings`);
    } catch (error) {
      const logger = getLogger();
      logger.error({ error, indexName }, `Failed to initialize index ${indexName}`);
      throw error;
    }
  }

  /**
   * Refresh the index to make documents searchable immediately.
   */
  async refreshIndex(): Promise<void> {
    const client = esClient.getClient();
    const indexName = this.ensureIndexName();

    try {
      await client.indices.refresh({ index: indexName });
      const logger = getLogger();
      logger.debug(`Refreshed index ${indexName}`);
    } catch (error) {
      const logger = getLogger();
      logger.error({ error, indexName }, `Failed to refresh index ${indexName}`);
      throw error;
    }
  }

  /**
   * Delete the index (for testing/cleanup).
   */
  async deleteIndex(): Promise<void> {
    const client = esClient.getClient();
    const indexName = this.ensureIndexName();

    try {
      const exists = await client.indices.exists({ index: indexName });

      if (exists) {
        await client.indices.delete({ index: indexName });
        const logger = getLogger();
        logger.info(`Deleted index ${indexName}`);
      }
    } catch (error) {
      const logger = getLogger();
      logger.error({ error, indexName }, `Failed to delete index ${indexName}`);
      throw error;
    }
  }

  /**
   * Get the index name.
   */
  getIndexName(): string {
    return this.ensureIndexName();
  }
}
