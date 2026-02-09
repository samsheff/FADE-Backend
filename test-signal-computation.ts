/**
 * Test script for Phase 3 signal computation
 *
 * Usage: tsx test-signal-computation.ts
 */

import { loadEnvironment } from './src/config/environment.js';
import { createPrismaClient, disconnectPrisma } from './src/adapters/database/client.js';
import { SignalComputationJob } from './src/jobs/signal-computation.job.js';
import { createLogger } from './src/utils/logger.js';

async function main() {
  const logger = createLogger();

  try {
    // Load environment
    logger.info('Loading environment...');
    loadEnvironment();

    // Initialize database
    logger.info('Connecting to database...');
    createPrismaClient();

    // Create and run job
    logger.info('Creating signal computation job...');
    const job = new SignalComputationJob();

    logger.info('Running signal computation (this may take a few seconds)...');
    await job.runOnce();

    logger.info('✅ Signal computation test complete');

    // Get status
    const status = job.getStatus();
    logger.info('Job status:', status);

  } catch (error) {
    logger.error('Test failed:', error);
    process.exit(1);
  } finally {
    await disconnectPrisma();
  }
}

main();
