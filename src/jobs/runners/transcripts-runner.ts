import { TranscriptsWorkerJob } from '../transcripts.job.js';
import { loadEnvironment } from '../../config/environment.js';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger();

/**
 * Transcripts Worker Runner
 * Entry point for running worker as standalone process
 */
async function main() {
  try {
    // Load environment
    const env = loadEnvironment();

    if (!env.TRANSCRIPTS_WORKER_ENABLED) {
      logger.warn('TRANSCRIPTS_WORKER_ENABLED is false, exiting');
      process.exit(0);
    }

    // Create and start job
    const job = new TranscriptsWorkerJob();

    // Graceful shutdown handlers
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, stopping transcripts worker');
      job.stop();
      process.exit(0);
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received, stopping transcripts worker');
      job.stop();
      process.exit(0);
    });

    // Start job
    await job.start();

    logger.info('Transcripts worker runner started successfully');
  } catch (error) {
    logger.error({ err: error }, 'Fatal error in transcripts worker');
    process.exit(1);
  }
}

main();
