import { loadEnvironment } from '../../config/environment.js';
import { createLogger } from '../../utils/logger.js';
import { createPrismaClient, disconnectPrisma } from '../../adapters/database/client.js';
import { EntityEnrichmentJob } from '../entity-enrichment.job.js';

/**
 * Entity Enrichment Worker
 *
 * Enriches instrument metadata with additional data sources.
 */
async function main(): Promise<void> {
  const env = loadEnvironment();
  const logger = createLogger();

  logger.info('🏷️  Starting Entity Enrichment Worker...');

  if (!env.ENTITY_ENRICHMENT_ENABLED) {
    logger.warn('ENTITY_ENRICHMENT_ENABLED is false, exiting...');
    process.exit(0);
  }

  createPrismaClient();
  logger.info('✅ Database connected');

  const job = new EntityEnrichmentJob();

  logger.info('🏷️  Starting entity enrichment job...');
  await job.start();
  logger.info('✅ Entity enrichment worker running');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received, shutting down entity enrichment worker...`);
    job.stop();
    await disconnectPrisma();
    logger.info('Entity enrichment worker stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('Entity enrichment worker failed:', error);
  process.exit(1);
});
