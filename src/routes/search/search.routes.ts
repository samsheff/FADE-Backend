import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SearchService } from '../../services/search/search.service.js';

let searchService: SearchService | null = null;

function getSearchService(): SearchService {
  if (!searchService) {
    searchService = new SearchService();
  }
  return searchService;
}

/**
 * Query parameters for autocomplete endpoint
 */
interface AutocompleteQuery {
  q: string;
}

/**
 * Query parameters for full search endpoint
 */
interface FullSearchQuery {
  q: string;
  limit?: string;
  offset?: string;
  entity_types?: string;
}

/**
 * Register search routes.
 */
export async function searchRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/search/autocomplete?q={query}
   * Returns top 3 results for autocomplete.
   */
  app.get<{ Querystring: AutocompleteQuery }>(
    '/autocomplete',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['q'],
          properties: {
            q: { type: 'string', minLength: 1 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              results: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    entity_type: { type: 'string' },
                    entity_id: { type: 'string' },
                    primary_text: { type: 'string' },
                    secondary_text: { type: 'string' },
                    symbol: { type: ['string', 'null'] },
                    category: { type: ['string', 'null'] },
                    has_signals: { type: 'boolean' },
                    signal_count: { type: 'number' },
                    metadata: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: AutocompleteQuery }>, reply: FastifyReply) => {
      const { q } = request.query;

      try {
        const results = await getSearchService().autocomplete(q);

        return reply.send({ results });
      } catch (error) {
        request.log.error({
          err: error,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }, 'Autocomplete search failed');
        return reply.status(500).send({
          error: 'Search failed',
          message: 'An error occurred while searching',
        });
      }
    }
  );

  /**
   * GET /api/v1/search?q={query}&limit=20&offset=0&entity_types=polymarket,equity
   * Returns full search results with pagination.
   */
  app.get<{ Querystring: FullSearchQuery }>(
    '/',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['q'],
          properties: {
            q: { type: 'string', minLength: 1 },
            limit: { type: 'string', pattern: '^[0-9]+$' },
            offset: { type: 'string', pattern: '^[0-9]+$' },
            entity_types: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              results: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    entity_type: { type: 'string' },
                    entity_id: { type: 'string' },
                    primary_text: { type: 'string' },
                    secondary_text: { type: 'string' },
                    symbol: { type: ['string', 'null'] },
                    category: { type: ['string', 'null'] },
                    has_signals: { type: 'boolean' },
                    signal_count: { type: 'number' },
                    metadata: { type: 'object' },
                  },
                },
              },
              total: { type: 'number' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: FullSearchQuery }>, reply: FastifyReply) => {
      const { q, limit, offset, entity_types } = request.query;

      try {
        const parsedLimit = limit ? parseInt(limit, 10) : 20;
        const parsedOffset = offset ? parseInt(offset, 10) : 0;
        const parsedEntityTypes = entity_types ? entity_types.split(',') : undefined;

        const { results, total } = await getSearchService().fullSearch(q, {
          limit: parsedLimit,
          offset: parsedOffset,
          entity_types: parsedEntityTypes,
        });

        return reply.send({ results, total });
      } catch (error) {
        request.log.error({
          err: error,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }, 'Full search failed');
        return reply.status(500).send({
          error: 'Search failed',
          message: 'An error occurred while searching',
        });
      }
    }
  );
}
