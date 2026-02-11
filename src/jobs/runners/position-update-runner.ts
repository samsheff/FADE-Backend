import { loadEnvironment } from '../../config/environment.js';
import { createLogger } from '../../utils/logger.js';
import { createPrismaClient, disconnectPrisma } from '../../adapters/database/client.js';
import { PositionUpdateJob } from '../position-update.job.js';

/**
 * Position Update Worker
 *
 * Updates user positions from blockchain and CLOB API.
 */
async function main(): Promise<void> {
  const env = loadEnvironment();
  const logger = createLogger();

  logger.info('💼 Starting Position Update Worker...');

  createPrismaClient();
  logger.info('✅ Database connected');

  const job = new PositionUpdateJob();

  logger.info('💼 Starting position update job...');
  await job.start();
  logger.info('✅ Position update worker running');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received, shutting down position update worker...`);
    job.stop();
    await disconnectPrisma();
    logger.info('Position update worker stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('Position update worker failed:', error);
  process.exit(1);
});
