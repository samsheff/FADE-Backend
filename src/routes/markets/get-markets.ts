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
                    yesPrice: { type: 'string', nullable: true },
                    noPrice: { type: 'string', nullable: true },
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
        active: true,
        category,
        expiresAfter: new Date(),
        limit,
        offset,
      };

      return await marketDataService.getMarkets(filters);
    },
  );

  app.get<{
    Querystring: {
      q?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/search',
    {
      schema: {
        tags: ['markets'],
        description: 'Searchable list of markets',
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', description: 'Search term (question, slug, or tag)' },
            limit: { type: 'string', description: 'Number of results (1-100)', default: '50' },
            offset: { type: 'string', description: 'Pagination offset', default: '0' },
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
                    yesPrice: { type: 'string', nullable: true },
                    noPrice: { type: 'string', nullable: true },
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
      const { q, limit: limitStr, offset: offsetStr } = request.query;
      const parsedLimit = limitStr ? parseInt(limitStr, 10) : undefined;
      const parsedOffset = offsetStr ? parseInt(offsetStr, 10) : undefined;

      const limit =
        parsedLimit !== undefined && !Number.isNaN(parsedLimit) && parsedLimit > 0 && parsedLimit <= 100
          ? parsedLimit
          : 50;
      const offset =
        parsedOffset !== undefined && !Number.isNaN(parsedOffset) && parsedOffset >= 0
          ? parsedOffset
          : 0;

      return await marketDataService.searchMarkets({
        query: q ?? '',
        limit,
        offset,
        active: true,
        expiresAfter: new Date(),
      });
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
