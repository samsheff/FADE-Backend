import { FastifyInstance } from 'fastify';
import { InstrumentService } from '../../services/instruments/instrument.service.js';

export async function instrumentsRoutes(app: FastifyInstance): Promise<void> {
  const instrumentService = new InstrumentService();

  app.get<{
    Querystring: {
      type?: string;
      status?: string;
      symbol?: string;
      exchange?: string;
      limit?: number;
      offset?: number;
    };
  }>(
    '/',
    {
      schema: {
        tags: ['instruments'],
        description: 'List instruments with optional filters',
        querystring: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['EQUITY', 'OPTION', 'FUTURE'] },
            status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED', 'DELISTED', 'HALTED'] },
            symbol: { type: 'string' },
            exchange: { type: 'string' },
            limit: { type: 'number', default: 20 },
            offset: { type: 'number', default: 0 },
          },
        },
      },
    },
    async (request) => {
      return instrumentService.findInstruments(request.query as any);
    },
  );

  app.get<{
    Params: {
      id: string;
    };
  }>(
    '/:id',
    {
      schema: {
        tags: ['instruments'],
        description: 'Get instrument by ID',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const instrument = await instrumentService.getInstrumentById(request.params.id);

      if (!instrument) {
        return reply.code(404).send({ error: 'Instrument not found' });
      }

      return instrument;
    },
  );

  app.get<{
    Params: {
      id: string;
    };
  }>(
    '/:id/signals',
    {
      schema: {
        tags: ['instruments'],
        description: 'Get signals for an instrument',
      },
    },
    async (request, reply) => {
      const signals = await instrumentService.getSignalsForInstrument(request.params.id);
      return { signals };
    },
  );

  app.get<{
    Params: {
      id: string;
    };
  }>(
    '/:id/filings',
    {
      schema: {
        tags: ['instruments'],
        description: 'Get filings for an instrument',
      },
    },
    async (request) => {
      return instrumentService.getFilingsForInstrument(request.params.id);
    },
  );
}
