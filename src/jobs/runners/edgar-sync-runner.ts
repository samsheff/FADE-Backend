import { loadEnvironment } from '../../config/environment.js';
import { createLogger } from '../../utils/logger.js';
import { createPrismaClient, disconnectPrisma } from '../../adapters/database/client.js';
import { EdgarSyncJob } from '../edgar-sync.job.js';

/**
 * EDGAR Filing Sync Worker
 *
 * Downloads and processes SEC EDGAR filings for tracked instruments.
 */
async function main(): Promise<void> {
  const env = loadEnvironment();
  const logger = createLogger();

  logger.info('📄 Starting EDGAR Filing Sync Worker...');

  if (!env.EDGAR_WORKER_ENABLED) {
    logger.warn('EDGAR_WORKER_ENABLED is false, exiting...');
    process.exit(0);
  }

  createPrismaClient();
  logger.info('✅ Database connected');

  const job = new EdgarSyncJob();

  logger.info('📄 Starting EDGAR filing sync job...');
  await job.start();
  logger.info('✅ EDGAR filing sync worker running');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received, shutting down EDGAR sync worker...`);
    job.stop();
    await disconnectPrisma();
    logger.info('EDGAR sync worker stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('EDGAR sync worker failed:', error);
  process.exit(1);
});
