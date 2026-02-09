import { loadEnvironment } from '../config/environment.js';
import { createLogger } from '../utils/logger.js';
import { createApp } from './app.js';
import { createPrismaClient, disconnectPrisma } from '../adapters/database/client.js';
import { registerRoutes } from '../routes/index.js';
import { MarketSyncJob } from '../jobs/market-sync.job.js';
import { PositionUpdateJob } from '../jobs/position-update.job.js';
import { EdgarSyncJob } from '../jobs/edgar-sync.job.js';
import { EdgarUniverseDiscoveryJob } from '../jobs/edgar-universe-discovery.job.js';
import { NewsWorkerJob } from '../jobs/news-worker.job.js';
import { SearchIndexerJob } from '../jobs/search-indexer.job.js';
import { EntityEnrichmentJob } from '../jobs/entity-enrichment.job.js';
import { SignalComputationJob } from '../jobs/signal-computation.job.js';
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

    // Start WebSocket stream immediately (subscribes to existing markets)
    logger.info('🔌 Starting WebSocket stream...');
    await streamService.start();
    logger.info('✅ WebSocket stream started');

    // Pass streamService to marketSyncJob so it can subscribe to new markets
    marketSyncJob.setStreamService(streamService);

    // Start market sync job in background (don't wait)
    logger.info('🔄 Starting market sync job in background...');
    marketSyncJob.start().catch((error) => {
      logger.error({ error }, 'Market sync job failed');
    });

    positionUpdateJob.start();
    logger.info('✅ Background jobs started');

    // Start EDGAR worker if enabled
    let edgarSyncJob: EdgarSyncJob | null = null;
    let edgarUniverseJob: EdgarUniverseDiscoveryJob | null = null;
    if (env.EDGAR_WORKER_ENABLED) {
      // Run universe discovery first to populate instruments before filing sync
      logger.info('🌐 Starting EDGAR universe discovery (will complete before filing sync)...');
      edgarUniverseJob = new EdgarUniverseDiscoveryJob();

      try {
        // Run initial universe sync and wait for completion (~26 seconds for ~10k issuers)
        await edgarUniverseJob.start();
        logger.info('✅ Universe discovery complete, instruments populated');
      } catch (error) {
        logger.error({ error }, 'Failed to complete initial universe discovery');
      }

      // Now start EDGAR filing sync (instruments are now available for linking)
      logger.info('🔍 Starting EDGAR filing sync job...');
      edgarSyncJob = new EdgarSyncJob();
      edgarSyncJob.start().catch((error) => {
        logger.error({ error }, 'Failed to start EDGAR filing sync job');
      });
      logger.info('✅ EDGAR filing sync job started and scheduled');
    }

    // Start News worker if enabled
    let newsWorkerJob: NewsWorkerJob | null = null;
    if (env.NEWS_WORKER_ENABLED) {
      logger.info('📰 Starting News worker...');
      newsWorkerJob = new NewsWorkerJob();
      newsWorkerJob.start().catch((error) => {
        logger.error({ error }, 'Failed to start News worker');
      });
      logger.info('✅ News worker started');
    }

    // Start search indexer if enabled
    let searchIndexerJob: SearchIndexerJob | null = null;
    if (env.SEARCH_INDEXER_ENABLED) {
      logger.info('🔍 Starting search indexer...');
      searchIndexerJob = new SearchIndexerJob();

      try {
        await searchIndexerJob.start(); // Wait for initial index
        logger.info('✅ Search indexer initialized');
      } catch (error) {
        logger.error({ error }, 'Failed to start search indexer');
      }
    }

    // Start entity enrichment job if enabled
    let entityEnrichmentJob: EntityEnrichmentJob | null = null;
    if (env.ENTITY_ENRICHMENT_ENABLED) {
      logger.info('🏷️ Starting entity enrichment job...');
      entityEnrichmentJob = new EntityEnrichmentJob();

      try {
        await entityEnrichmentJob.start(); // Wait for backfill to complete
        logger.info('✅ Entity enrichment job initialized and scheduled');
      } catch (error) {
        logger.error({ error }, 'Failed to start entity enrichment job');
      }
    }

    // Start signal computation job if enabled
    let signalComputationJob: SignalComputationJob | null = null;
    if (env.SIGNAL_COMPUTATION_ENABLED) {
      logger.info('🔔 Starting signal computation job...');
      signalComputationJob = new SignalComputationJob();

      try {
        await signalComputationJob.start();
        logger.info('✅ Signal computation job initialized and scheduled');
      } catch (error) {
        logger.error({ error }, 'Failed to start signal computation job');
      }
    }

    // Graceful shutdown
    const shutdown = async (signal: string): Promise<void> => {
      logger.info(`${signal} received, shutting down gracefully...`);

      // Stop background jobs
      marketSyncJob.stop();
      positionUpdateJob.stop();
      streamService.stop();
      realtimeGateway.close();

      if (edgarSyncJob) {
        logger.info('Stopping EDGAR sync job...');
        edgarSyncJob.stop();
      }

      if (edgarUniverseJob) {
        logger.info('Stopping EDGAR universe discovery job...');
        edgarUniverseJob.stop();
      }

      if (newsWorkerJob) {
        logger.info('Stopping News worker...');
        newsWorkerJob.stop();
      }

      if (searchIndexerJob) {
        logger.info('Stopping search indexer job...');
        searchIndexerJob.stop();
      }

      if (entityEnrichmentJob) {
        logger.info('Stopping entity enrichment job...');
        entityEnrichmentJob.stop();
      }

      if (signalComputationJob) {
        logger.info('Stopping signal computation job...');
        signalComputationJob.stop();
      }

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
