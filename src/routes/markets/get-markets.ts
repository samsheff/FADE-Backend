import { FastifyInstance } from 'fastify';
import { MarketDataService } from '../../services/market-data/market-data.service.js';
import { MarketListResponse } from '../../types/market.types.js';
import { validatePagination } from '../../utils/validators.js';

export async function getMarketsRoutes(app: FastifyInstance): Promise<void> {
  const marketDataService = new MarketDataService();

  app.get<{
    Querystring: {
      active?: string;
      category?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/',
    {
      schema: {
        tags: ['markets'],
        description: 'Get list of markets',
        querystring: {
          type: 'object',
          properties: {
            active: { type: 'string', description: 'Filter by active status' },
            category: { type: 'string', description: 'Filter by category tag' },
            limit: { type: 'string', description: 'Number of results (max 100)', default: '20' },
            offset: { type: 'string', description: 'Offset for pagination', default: '0' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              markets: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    question: { type: 'string' },
                    outcomes: { type: 'array', items: { type: 'string' } },
                    expiryDate: { type: 'string' },
                    liquidity: { type: 'string' },
                    volume24h: { type: 'string' },
                    categoryTag: { type: 'string', nullable: true },
                    marketSlug: { type: 'string' },
                    active: { type: 'boolean' },
                  },
                },
              },
              total: { type: 'number' },
            },
          },
        },
      },
    },
    async (request): Promise<MarketListResponse> => {
      const { active, category, limit: limitStr, offset: offsetStr } = request.query;

      const { limit, offset } = validatePagination(
        limitStr ? parseInt(limitStr) : undefined,
        offsetStr ? parseInt(offsetStr) : undefined,
      );

      const filters = {
        active: active === 'true' ? true : active === 'false' ? false : undefined,
        category,
        limit,
        offset,
      };

      return await marketDataService.getMarkets(filters);
    },
  );

  app.get<{
    Params: { id: string };
  }>(
    '/:id',
    {
      schema: {
        tags: ['markets'],
        description: 'Get market by ID',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Market condition ID' },
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params;
      return await marketDataService.getMarketById(id);
    },
  );

  app.get<{
    Params: { id: string };
    Querystring: { outcome?: string };
  }>(
    '/:id/orderbook',
    {
      schema: {
        tags: ['markets'],
        description: 'Get orderbook for market outcome',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Market condition ID' },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            outcome: {
              type: 'string',
              description: 'Outcome (YES or NO)',
              default: 'YES',
            },
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params;
      const outcome = request.query.outcome || 'YES';
      return await marketDataService.getOrderbook(id, outcome);
    },
  );
}
