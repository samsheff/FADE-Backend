import { loadEnvironment } from '../../config/environment.js';
import { createLogger } from '../../utils/logger.js';
import { createPrismaClient, disconnectPrisma } from '../../adapters/database/client.js';
import { EdgarUniverseDiscoveryJob } from '../edgar-universe-discovery.job.js';

/**
 * EDGAR Universe Discovery Worker
 *
 * Discovers and populates the universe of traded instruments
 * from SEC company tickers list.
 */
async function main(): Promise<void> {
  const env = loadEnvironment();
  const logger = createLogger();

  logger.info('🌐 Starting EDGAR Universe Discovery Worker...');

  if (!env.EDGAR_WORKER_ENABLED) {
    logger.warn('EDGAR_WORKER_ENABLED is false, exiting...');
    process.exit(0);
  }

  createPrismaClient();
  logger.info('✅ Database connected');

  const job = new EdgarUniverseDiscoveryJob();

  logger.info('🌐 Starting universe discovery job...');
  await job.start();
  logger.info('✅ Universe discovery worker running');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received, shutting down universe discovery worker...`);
    job.stop();
    await disconnectPrisma();
    logger.info('Universe discovery worker stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('Universe discovery worker failed:', error);
  process.exit(1);
});
