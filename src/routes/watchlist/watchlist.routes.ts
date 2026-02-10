import { FastifyInstance } from 'fastify';
import { WatchlistService } from '../../services/watchlist/watchlist.service.js';

export async function watchlistRoutes(app: FastifyInstance): Promise<void> {
  const watchlistService = new WatchlistService();

  // List all watchlists
  app.get(
    '/',
    {
      schema: {
        tags: ['watchlists'],
        description: 'List all watchlists',
      },
    },
    async () => {
      return watchlistService.getAllWatchlists();
    },
  );

  // Get a specific watchlist
  app.get<{
    Params: { id: string };
  }>(
    '/:id',
    {
      schema: {
        tags: ['watchlists'],
        description: 'Get a watchlist by ID',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
      },
    },
    async (request, reply) => {
      const watchlist = await watchlistService.getWatchlistById(request.params.id);
      if (!watchlist) {
        return reply.status(404).send({ error: 'Watchlist not found' });
      }
      return watchlist;
    },
  );

  // Get watchlist with markets
  app.get<{
    Params: { id: string };
  }>(
    '/:id/markets',
    {
      schema: {
        tags: ['watchlists'],
        description: 'Get a watchlist with all its markets (includes full market details)',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
      },
    },
    async (request, reply) => {
      const watchlist = await watchlistService.getWatchlistWithMarkets(request.params.id);
      if (!watchlist) {
        return reply.status(404).send({ error: 'Watchlist not found' });
      }
      return watchlist;
    },
  );

  // Create a new watchlist
  app.post<{
    Body: {
      name: string;
      sortOrder: number;
    };
  }>(
    '/',
    {
      schema: {
        tags: ['watchlists'],
        description: 'Create a new watchlist',
        body: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            sortOrder: { type: 'number', minimum: 1, maximum: 9 },
          },
          required: ['name', 'sortOrder'],
        },
      },
    },
    async (request, reply) => {
      try {
        const watchlist = await watchlistService.createWatchlist(request.body);
        return reply.status(201).send(watchlist);
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    },
  );

  // Update a watchlist
  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      sortOrder?: number;
    };
  }>(
    '/:id',
    {
      schema: {
        tags: ['watchlists'],
        description: 'Update a watchlist',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
        body: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            sortOrder: { type: 'number', minimum: 1, maximum: 9 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const watchlist = await watchlistService.updateWatchlist(request.params.id, request.body);
        if (!watchlist) {
          return reply.status(404).send({ error: 'Watchlist not found' });
        }
        return watchlist;
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    },
  );

  // Delete a watchlist
  app.delete<{
    Params: { id: string };
  }>(
    '/:id',
    {
      schema: {
        tags: ['watchlists'],
        description: 'Delete a watchlist',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
      },
    },
    async (request, reply) => {
      const success = await watchlistService.deleteWatchlist(request.params.id);
      if (!success) {
        return reply.status(404).send({ error: 'Watchlist not found' });
      }
      return reply.status(204).send();
    },
  );

  // Toggle market membership in a watchlist
  app.post<{
    Params: { id: string; marketId: string };
  }>(
    '/:id/markets/:marketId/toggle',
    {
      schema: {
        tags: ['watchlists'],
        description: 'Toggle market membership in a watchlist (add if not present, remove if present)',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            marketId: { type: 'string' },
          },
          required: ['id', 'marketId'],
        },
      },
    },
    async (request) => {
      return watchlistService.toggleMarket(request.params.id, request.params.marketId);
    },
  );

  // Get watchlists for a specific market
  app.get<{
    Params: { marketId: string };
  }>(
    '/by-market/:marketId',
    {
      schema: {
        tags: ['watchlists'],
        description: 'Get all watchlists that contain a specific market',
        params: {
          type: 'object',
          properties: {
            marketId: { type: 'string' },
          },
          required: ['marketId'],
        },
      },
    },
    async (request) => {
      return watchlistService.getWatchlistsForMarket(request.params.marketId);
    },
  );
}
