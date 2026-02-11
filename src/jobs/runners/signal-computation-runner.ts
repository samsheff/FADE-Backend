import { loadEnvironment } from '../../config/environment.js';
import { createLogger } from '../../utils/logger.js';
import { createPrismaClient, disconnectPrisma } from '../../adapters/database/client.js';
import { SignalComputationJob } from '../signal-computation.job.js';

/**
 * Signal Computation Worker
 *
 * Computes derived signals from base signals (competitor analysis, factor extraction).
 */
async function main(): Promise<void> {
  const env = loadEnvironment();
  const logger = createLogger();

  logger.info('🔔 Starting Signal Computation Worker...');

  if (!env.SIGNAL_COMPUTATION_ENABLED) {
    logger.warn('SIGNAL_COMPUTATION_ENABLED is false, exiting...');
    process.exit(0);
  }

  createPrismaClient();
  logger.info('✅ Database connected');

  const job = new SignalComputationJob();

  logger.info('🔔 Starting signal computation job...');
  await job.start();
  logger.info('✅ Signal computation worker running');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received, shutting down signal computation worker...`);
    job.stop();
    await disconnectPrisma();
    logger.info('Signal computation worker stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('Signal computation worker failed:', error);
  process.exit(1);
});
