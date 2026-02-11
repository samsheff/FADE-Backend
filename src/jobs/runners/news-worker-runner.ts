import { loadEnvironment } from '../../config/environment.js';
import { createLogger } from '../../utils/logger.js';
import { createPrismaClient, disconnectPrisma } from '../../adapters/database/client.js';
import { NewsWorkerJob } from '../news-worker.job.js';

/**
 * News Worker
 *
 * Fetches news articles, downloads content, and extracts signals.
 */
async function main(): Promise<void> {
  const env = loadEnvironment();
  const logger = createLogger();

  logger.info('📰 Starting News Worker...');

  if (!env.NEWS_WORKER_ENABLED) {
    logger.warn('NEWS_WORKER_ENABLED is false, exiting...');
    process.exit(0);
  }

  createPrismaClient();
  logger.info('✅ Database connected');

  const job = new NewsWorkerJob();

  logger.info('📰 Starting news worker job...');
  await job.start();
  logger.info('✅ News worker running');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received, shutting down news worker...`);
    job.stop();
    await disconnectPrisma();
    logger.info('News worker stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('News worker failed:', error);
  process.exit(1);
});
