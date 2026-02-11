import { loadEnvironment } from '../../config/environment.js';
import { createLogger } from '../../utils/logger.js';
import { createPrismaClient, disconnectPrisma } from '../../adapters/database/client.js';
import { MarketSyncJob } from '../market-sync.job.js';
import { MarketDataPubSub } from '../../services/market-data/market-pubsub.service.js';
import { MarketDataStreamService } from '../../services/market-data/market-data-stream.service.js';

/**
 * Market Sync Worker
 *
 * Standalone worker that syncs market data from Polymarket API
 * and streams real-time orderbook updates via WebSocket.
 *
 * Responsibilities:
 * - Fetch markets from Polymarket API
 * - Subscribe to CLOB WebSocket for orderbook updates
 * - Publish updates to MarketDataPubSub (consumed by API server)
 * - Store market data and orderbook snapshots in database
 */
async function main(): Promise<void> {
  loadEnvironment();
  const logger = createLogger();

  logger.info('🔄 Starting Market Sync Worker...');

  // Initialize database
  createPrismaClient();
  logger.info('✅ Database connected');

  // Initialize market data services
  const pubsub = new MarketDataPubSub();
  const streamService = new MarketDataStreamService(pubsub);
  const job = new MarketSyncJob();

  // Start WebSocket stream
  logger.info('🔌 Starting WebSocket stream...');
  await streamService.start();
  logger.info('✅ WebSocket stream started');

  // Pass stream service to market sync job
  job.setStreamService(streamService);

  // Start market sync job
  logger.info('🔄 Starting market sync job...');
  await job.start();
  logger.info('✅ Market sync worker running');

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received, shutting down market sync worker...`);

    job.stop();
    streamService.stop();
    await disconnectPrisma();

    logger.info('Market sync worker stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('Market sync worker failed:', error);
  process.exit(1);
});
