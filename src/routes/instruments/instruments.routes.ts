import { FastifyInstance } from 'fastify';
import { InstrumentService } from '../../services/instruments/instrument.service.js';
import { UnifiedCandleService } from '../../services/market-data/unified-candle.service.js';
import { CandleInterval } from '../../types/market-data.types.js';
import { ValidationError } from '../../utils/errors.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const INTERVALS: CandleInterval[] = ['1s', '5s', '1m', '5m', '15m', '1h', '1d'];

function parseTimestamp(value: string): Date {
  const asNumber = Number(value);
  const date = Number.isNaN(asNumber) ? new Date(value) : new Date(asNumber);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`Invalid timestamp: ${value}`);
  }
  return date;
}

function intervalToMs(interval: CandleInterval): number {
  switch (interval) {
    case '1s':
      return 1000;
    case '5s':
      return 5000;
    case '1m':
      return 60_000;
    case '5m':
      return 300_000;
    case '15m':
      return 900_000;
    case '1h':
      return 3_600_000;
    case '1d':
      return 86_400_000;
  }
}

export async function instrumentsRoutes(app: FastifyInstance): Promise<void> {
  const instrumentService = new InstrumentService();
  const candleService = new UnifiedCandleService();

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

  // New route: Get candles for instrument
  app.get<{
    Params: { id: string };
    Querystring: {
      interval?: string;
      from?: string;
      to?: string;
      limit?: string;
    };
  }>(
    '/:id/candles',
    {
      schema: {
        tags: ['instruments'],
        description: 'Get OHLC candles for instrument',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Instrument ID' },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            interval: { type: 'string', description: 'Candle interval', default: '1d' },
            from: { type: 'string', description: 'Start timestamp (ms or ISO)' },
            to: { type: 'string', description: 'End timestamp (ms or ISO)' },
            limit: { type: 'string', description: 'Max candles to return', default: '200' },
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params;
      const interval = (request.query.interval || '1d') as CandleInterval;

      if (!INTERVALS.includes(interval)) {
        throw new ValidationError(`Unsupported interval: ${interval}`);
      }

      const limit = request.query.limit ? Number(request.query.limit) : 200;
      if (!Number.isFinite(limit) || limit <= 0) {
        throw new ValidationError('Invalid limit');
      }

      const now = new Date();
      const to = request.query.to ? parseTimestamp(request.query.to) : now;
      const from = request.query.from
        ? parseTimestamp(request.query.from)
        : new Date(to.getTime() - intervalToMs(interval) * limit);

      const candles = await candleService.getCandles({
        instrumentId: id,
        interval,
        from,
        to,
        limit,
      });

      return {
        candles,
        meta: {
          instrumentId: id,
          interval,
          from: from.toISOString(),
          to: to.toISOString(),
          count: candles.length,
        },
      };
    },
  );

  // New route: Get findings (enriched evidence) for instrument
  app.get<{
    Params: { id: string };
  }>(
    '/:id/findings',
    {
      schema: {
        tags: ['instruments'],
        description: 'Get enriched evidence findings for instrument',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Instrument ID' },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      // Get latest signal for this instrument
      const signal = await prisma.instrumentSignal.findFirst({
        where: { instrumentId: id },
        orderBy: { computedAt: 'desc' },
      });

      if (!signal) {
        return {
          latestSignal: null,
          evidenceItems: [],
        };
      }

      // Fetch evidence facts
      const factIds = signal.evidenceFacts as string[];
      const facts = await prisma.filingFact.findMany({
        where: { id: { in: factIds } },
        include: { filing: true },
      });

      // Helper to extract summary from fact data
      const extractSummary = (data: any): string => {
        if (typeof data === 'string') {
          return data;
        }
        if (data && typeof data === 'object') {
          return data.summary || data.description || JSON.stringify(data).slice(0, 100);
        }
        return 'No summary available';
      };

      // Helper to construct SEC URL
      const constructSECUrl = (filing: any): string => {
        const accessionNoSlash = filing.accessionNumber.replace(/-/g, '');
        return `https://www.sec.gov/cgi-bin/viewer?action=view&cik=${filing.cik}&accession_number=${filing.accessionNumber}&xbrl_type=v`;
      };

      return {
        latestSignal: {
          signalType: signal.signalType,
          severity: signal.severity,
          score: signal.score.toString(),
          reason: signal.reason,
          computedAt: signal.computedAt,
        },
        evidenceItems: facts.map((fact) => ({
          id: fact.id,
          factType: fact.factType,
          confidence: fact.confidence ? fact.confidence.toString() : '1.0',
          summary: extractSummary(fact.data),
          excerpt: fact.evidence ? fact.evidence.slice(0, 200) + '...' : null,
          filing: {
            id: fact.filing.id,
            filingType: fact.filing.filingType,
            filingDate: fact.filing.filingDate,
            accessionNumber: fact.filing.accessionNumber,
            url: constructSECUrl(fact.filing),
          },
        })),
      };
    },
  );
}
