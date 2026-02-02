import { FastifyInstance } from 'fastify';
import { HistoricalMarketDataSync } from '../../services/market-data/historical-sync.service.js';
import { MarketBackfillRepository } from '../../adapters/database/repositories/market-backfill.repository.js';

export async function backfillRoutes(app: FastifyInstance): Promise<void> {
  const historicalSync = new HistoricalMarketDataSync();
  const backfillRepo = new MarketBackfillRepository();

  app.post<{
    Body: {
      marketIds?: string[];
      skipIfCompleted?: boolean;
    };
  }>(
    '/backfill',
    {
      schema: {
        tags: ['admin'],
        description: 'Trigger historical backfill for specific markets',
        body: {
          type: 'object',
          properties: {
            marketIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Market IDs to backfill (empty = all pending/failed)',
            },
            skipIfCompleted: {
              type: 'boolean',
              description: 'Skip markets that are already completed',
              default: true,
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              marketIds: { type: 'array', items: { type: 'string' } },
              count: { type: 'number' },
            },
          },
        },
      },
    },
    async (request) => {
      const { marketIds, skipIfCompleted = true } = request.body || {};

      if (marketIds && marketIds.length > 0) {
        // Trigger backfill for specific markets (don't block)
        historicalSync
          .backfillNewMarkets(marketIds, { skipIfCompleted })
          .catch((error) => {
            app.log.error({ error }, 'Backfill failed');
          });

        return {
          message: 'Backfill triggered for specified markets',
          marketIds,
          count: marketIds.length,
        };
      } else {
        // Trigger backfill for all pending/failed markets (don't block)
        historicalSync.backfillAllMarkets({ skipIfCompleted }).catch((error) => {
          app.log.error({ error }, 'Backfill failed');
        });

        return {
          message: 'Backfill triggered for all pending/failed markets',
          marketIds: [],
          count: 0,
        };
      }
    },
  );

  app.get<{
    Querystring: {
      status?: 'pending' | 'in_progress' | 'completed' | 'failed';
      limit?: string;
    };
  }>(
    '/backfill/status',
    {
      schema: {
        tags: ['admin'],
        description: 'Get backfill status for all markets',
        querystring: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed', 'failed'],
              description: 'Filter by backfill status',
            },
            limit: {
              type: 'string',
              description: 'Max results to return',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              backfills: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    marketId: { type: 'string' },
                    status: { type: 'string' },
                    tradeEventsCount: { type: 'number' },
                    orderbookEventsCount: { type: 'number' },
                    earliestTimestamp: { type: 'string', nullable: true },
                    latestTimestamp: { type: 'string', nullable: true },
                    errorMessage: { type: 'string', nullable: true },
                    startedAt: { type: 'string', nullable: true },
                    completedAt: { type: 'string', nullable: true },
                    createdAt: { type: 'string' },
                    updatedAt: { type: 'string' },
                  },
                },
              },
              total: { type: 'number' },
            },
          },
        },
      },
    },
    async (request) => {
      const { status, limit: limitStr } = request.query;

      let backfills;
      if (status) {
        backfills = await backfillRepo.findByStatus(status);
      } else {
        backfills = await backfillRepo.findAll();
      }

      // Apply limit if provided
      const limit = limitStr ? parseInt(limitStr, 10) : undefined;
      if (limit && !isNaN(limit) && limit > 0) {
        backfills = backfills.slice(0, limit);
      }

      return {
        backfills: backfills.map((b) => ({
          marketId: b.marketId,
          status: b.status,
          tradeEventsCount: b.tradeEventsCount,
          orderbookEventsCount: b.orderbookEventsCount,
          earliestTimestamp: b.earliestTimestamp?.toISOString() || null,
          latestTimestamp: b.latestTimestamp?.toISOString() || null,
          errorMessage: b.errorMessage,
          startedAt: b.startedAt?.toISOString() || null,
          completedAt: b.completedAt?.toISOString() || null,
          createdAt: b.createdAt.toISOString(),
          updatedAt: b.updatedAt.toISOString(),
        })),
        total: backfills.length,
      };
    },
  );

  app.get<{
    Params: { marketId: string };
  }>(
    '/backfill/:marketId',
    {
      schema: {
        tags: ['admin'],
        description: 'Get backfill status for a specific market',
        params: {
          type: 'object',
          required: ['marketId'],
          properties: {
            marketId: { type: 'string', description: 'Market condition ID' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              marketId: { type: 'string' },
              status: { type: 'string' },
              tradeEventsCount: { type: 'number' },
              orderbookEventsCount: { type: 'number' },
              earliestTimestamp: { type: 'string', nullable: true },
              latestTimestamp: { type: 'string', nullable: true },
              errorMessage: { type: 'string', nullable: true },
              startedAt: { type: 'string', nullable: true },
              completedAt: { type: 'string', nullable: true },
              createdAt: { type: 'string' },
              updatedAt: { type: 'string' },
            },
          },
          404: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { marketId } = request.params;

      const backfill = await backfillRepo.findById(marketId);

      if (!backfill) {
        reply.code(404);
        return { error: 'Backfill not found for this market' };
      }

      return {
        marketId: backfill.marketId,
        status: backfill.status,
        tradeEventsCount: backfill.tradeEventsCount,
        orderbookEventsCount: backfill.orderbookEventsCount,
        earliestTimestamp: backfill.earliestTimestamp?.toISOString() || null,
        latestTimestamp: backfill.latestTimestamp?.toISOString() || null,
        errorMessage: backfill.errorMessage,
        startedAt: backfill.startedAt?.toISOString() || null,
        completedAt: backfill.completedAt?.toISOString() || null,
        createdAt: backfill.createdAt.toISOString(),
        updatedAt: backfill.updatedAt.toISOString(),
      };
    },
  );
}
