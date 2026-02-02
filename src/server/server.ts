import { loadEnvironment } from '../config/environment.js';
import { createLogger } from '../utils/logger.js';
import { createApp } from './app.js';
import { createPrismaClient, disconnectPrisma } from '../adapters/database/client.js';
import { registerRoutes } from '../routes/index.js';
import { MarketSyncJob } from '../jobs/market-sync.job.js';
import { PositionUpdateJob } from '../jobs/position-update.job.js';
import { MarketDataPubSub } from '../services/market-data/market-pubsub.service.js';
import { MarketDataStreamService } from '../services/market-data/market-data-stream.service.js';
import { MarketDataService } from '../services/market-data/market-data.service.js';
import { MarketRealtimeGateway } from './market-realtime.gateway.js';

async function start(): Promise<void> {
  try {
    // Load and validate environment variables
    const env = loadEnvironment();

    // Initialize logger
    const logger = createLogger();

    logger.info('🚀 Starting Polymarket Terminal Backend...');
    logger.info(`Environment: ${env.NODE_ENV}`);

    // Initialize database
    createPrismaClient();
    logger.info('✅ Database connected');

    // Create Fastify app
    const app = await createApp();

    // Register all routes
    await registerRoutes(app);
    logger.info('✅ Routes registered');

    // Start server
    await app.listen({
      port: env.PORT,
      host: env.HOST,
    });

    logger.info(`✅ Server listening on http://${env.HOST}:${env.PORT}`);
    logger.info(`📚 API Documentation: http://${env.HOST}:${env.PORT}/documentation`);

    // Start background jobs
    const marketSyncJob = new MarketSyncJob();
    const positionUpdateJob = new PositionUpdateJob();

    const pubsub = new MarketDataPubSub();
    const marketDataService = new MarketDataService();
    const streamService = new MarketDataStreamService(pubsub);
    const realtimeGateway = new MarketRealtimeGateway(app, pubsub, marketDataService);

    // Start market sync job (waits for initial full sync to complete)
    logger.info('🔄 Running initial market sync...');
    await marketSyncJob.start();
    logger.info('✅ Initial market sync completed');

    positionUpdateJob.start();
    await streamService.start();
    logger.info('✅ Background jobs started');

    // Graceful shutdown
    const shutdown = async (signal: string): Promise<void> => {
      logger.info(`${signal} received, shutting down gracefully...`);

      // Stop background jobs
      marketSyncJob.stop();
      positionUpdateJob.stop();
      streamService.stop();
      realtimeGateway.close();

      await app.close();
      await disconnectPrisma();
      logger.info('Server closed');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
