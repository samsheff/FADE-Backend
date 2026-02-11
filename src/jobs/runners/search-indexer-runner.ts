import { loadEnvironment } from '../../config/environment.js';
import { createLogger } from '../../utils/logger.js';
import { createPrismaClient, disconnectPrisma } from '../../adapters/database/client.js';
import { SearchIndexerJob } from '../search-indexer.job.js';

/**
 * Search Indexer Worker
 *
 * Indexes markets, instruments, and documents in OpenSearch/Elasticsearch.
 */
async function main(): Promise<void> {
  const env = loadEnvironment();
  const logger = createLogger();

  logger.info('🔍 Starting Search Indexer Worker...');

  if (!env.SEARCH_INDEXER_ENABLED) {
    logger.warn('SEARCH_INDEXER_ENABLED is false, exiting...');
    process.exit(0);
  }

  createPrismaClient();
  logger.info('✅ Database connected');

  const job = new SearchIndexerJob();

  logger.info('🔍 Starting search indexer job...');
  await job.start();
  logger.info('✅ Search indexer worker running');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received, shutting down search indexer worker...`);
    job.stop();
    await disconnectPrisma();
    logger.info('Search indexer worker stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('Search indexer worker failed:', error);
  process.exit(1);
});
