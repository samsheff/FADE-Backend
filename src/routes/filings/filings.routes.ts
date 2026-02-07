import { FastifyInstance } from 'fastify';
import { FilingService } from '../../services/filings/filing.service.js';

export async function filingsRoutes(app: FastifyInstance): Promise<void> {
  const filingService = new FilingService();

  app.get<{
    Params: {
      id: string;
    };
  }>(
    '/:id',
    {
      schema: {
        tags: ['filings'],
        description: 'Get filing by ID',
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
      const filing = await filingService.getFilingById(request.params.id);

      if (!filing) {
        return reply.code(404).send({ error: 'Filing not found' });
      }

      return filing;
    },
  );

  app.get<{
    Params: {
      id: string;
    };
  }>(
    '/:id/content',
    {
      schema: {
        tags: ['filings'],
        description: 'Get filing content (full text)',
      },
    },
    async (request, reply) => {
      const content = await filingService.getFilingContent(request.params.id);

      if (!content) {
        return reply.code(404).send({ error: 'Filing content not found' });
      }

      return content;
    },
  );

  app.get<{
    Params: {
      id: string;
    };
  }>(
    '/:id/facts',
    {
      schema: {
        tags: ['filings'],
        description: 'Get extracted facts from filing',
      },
    },
    async (request) => {
      const facts = await filingService.getFilingFacts(request.params.id);
      return { facts };
    },
  );

  app.get<{
    Querystring: {
      cik?: string;
      filingType?: string;
      status?: string;
      limit?: number;
      offset?: number;
    };
  }>(
    '/',
    {
      schema: {
        tags: ['filings'],
        description: 'List filings with optional filters',
        querystring: {
          type: 'object',
          properties: {
            cik: { type: 'string' },
            filingType: {
              type: 'string',
              enum: ['FORM_8K', 'FORM_10Q', 'FORM_10K', 'FORM_424B5', 'FORM_S3', 'ATM_FILING', 'PROXY_DEF14A', 'OTHER'],
            },
            status: {
              type: 'string',
              enum: ['PENDING', 'DOWNLOADING', 'DOWNLOADED', 'PARSED', 'ENRICHED', 'FAILED'],
            },
            limit: { type: 'number', default: 20 },
            offset: { type: 'number', default: 0 },
          },
        },
      },
    },
    async (request) => {
      return filingService.findFilings(request.query as any);
    },
  );
}
