import { loadEnvironment } from '../config/environment.js';
import { createLogger } from '../utils/logger.js';
import { createApp } from './app.js';
import { createPrismaClient, disconnectPrisma } from '../adapters/database/client.js';
import { registerRoutes } from '../routes/index.js';
import { MarketDataPubSub } from '../services/market-data/market-pubsub.service.js';
import { MarketDataService } from '../services/market-data/market-data.service.js';
import { MarketRealtimeGateway } from './market-realtime.gateway.js';

/**
 * Production API Server
 *
 * Runs HTTP API + WebSocket gateway without background workers.
 * Background jobs run in separate worker containers.
 *
 * Services:
 * - HTTP API routes (REST endpoints)
 * - WebSocket gateway (real-time market data)
 * - Health check endpoint
 */
async function start(): Promise<void> {
  try {
    // Load and validate environment variables
    const env = loadEnvironment();

    // Initialize logger
    const logger = createLogger();

    logger.info('🚀 Starting Polymarket Terminal API Server...');
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
    logger.info(`❤️ Health Check: http://${env.HOST}:${env.PORT}/health`);

    // Initialize real-time WebSocket gateway
    // This provides real-time market data to connected clients
    // The actual market sync runs in a separate worker container
    const pubsub = new MarketDataPubSub();
    const marketDataService = new MarketDataService();
    const realtimeGateway = new MarketRealtimeGateway(app, pubsub, marketDataService);

    logger.info('✅ WebSocket gateway initialized');
    logger.info('ℹ️  Background workers run in separate containers');

    // Graceful shutdown
    const shutdown = async (signal: string): Promise<void> => {
      logger.info(`${signal} received, shutting down gracefully...`);

      // Close WebSocket connections
      realtimeGateway.close();

      // Close HTTP server
      await app.close();

      // Disconnect database
      await disconnectPrisma();

      logger.info('API server closed');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    console.error('Failed to start API server:', error);
    process.exit(1);
  }
}

start();
