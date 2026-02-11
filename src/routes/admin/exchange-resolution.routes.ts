/**
 * Admin API Routes for TradingView Exchange Resolution
 *
 * Provides endpoints to manually trigger and monitor exchange resolution jobs.
 */

import { FastifyInstance } from 'fastify';
import { TradingViewExchangeResolutionJob } from '../../jobs/tradingview-exchange-resolution.job.js';

export async function exchangeResolutionRoutes(app: FastifyInstance) {
  const resolutionJob = new TradingViewExchangeResolutionJob();

  /**
   * POST /admin/exchange-resolution/run-batch
   *
   * Manually trigger a single batch of exchange resolutions
   */
  app.post('/run-batch', async (request, reply) => {
    try {
      request.log.info('Manual batch resolution triggered');

      const result = await resolutionJob.runBatch();

      return reply.status(200).send({
        success: true,
        message: 'Batch resolution completed',
        ...result,
      });
    } catch (error) {
      request.log.error({ error }, 'Batch resolution failed');

      return reply.status(500).send({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /admin/exchange-resolution/run-continuous
   *
   * Run multiple batches until complete or max batches reached
   */
  app.post<{
    Querystring: { maxBatches?: string };
  }>('/run-continuous', async (request, reply) => {
    try {
      const maxBatches = request.query.maxBatches
        ? parseInt(request.query.maxBatches, 10)
        : 10;

      request.log.info({ maxBatches }, 'Manual continuous resolution triggered');

      const result = await resolutionJob.runContinuous(maxBatches);

      return reply.status(200).send({
        success: true,
        message: 'Continuous resolution completed',
        ...result,
      });
    } catch (error) {
      request.log.error({ error }, 'Continuous resolution failed');

      return reply.status(500).send({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /admin/exchange-resolution/stats
   *
   * Get statistics about resolution status
   */
  app.get('/stats', async (request, reply) => {
    try {
      const [stats, pendingCount] = await Promise.all([
        resolutionJob.getResolutionStats(),
        resolutionJob.getPendingCount(),
      ]);

      return reply.status(200).send({
        success: true,
        stats: {
          ...stats,
          pendingCount,
        },
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to fetch resolution stats');

      return reply.status(500).send({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
