import { FastifyInstance } from 'fastify';
import { CandleAggregator } from '../../services/market-data/candle-aggregator.service.js';
import { CandleInterval, MarketOutcome } from '../../types/market-data.types.js';
import { ValidationError } from '../../utils/errors.js';

const INTERVALS: CandleInterval[] = ['1s', '5s', '1m', '5m', '1h'];

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
    case '1h':
      return 3_600_000;
  }
}

export async function getCandlesRoutes(app: FastifyInstance): Promise<void> {
  const aggregator = new CandleAggregator();

  app.get<{
    Params: { id: string };
    Querystring: {
      interval?: string;
      outcome?: string;
      from?: string;
      to?: string;
      limit?: string;
    };
  }>(
    '/:id/candles',
    {
      schema: {
        tags: ['markets'],
        description: 'Get OHLC candles for market outcome',
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
            interval: { type: 'string', description: 'Candle interval', default: '1m' },
            outcome: { type: 'string', description: 'Outcome (YES or NO)', default: 'YES' },
            from: { type: 'string', description: 'Start timestamp (ms or ISO)' },
            to: { type: 'string', description: 'End timestamp (ms or ISO)' },
            limit: { type: 'string', description: 'Max candles to return' },
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params;
      const interval = (request.query.interval || '1m') as CandleInterval;
      if (!INTERVALS.includes(interval)) {
        throw new ValidationError(`Unsupported interval: ${interval}`);
      }

      const outcome = ((request.query.outcome || 'YES').toUpperCase() as MarketOutcome) || 'YES';
      if (outcome !== 'YES' && outcome !== 'NO') {
        throw new ValidationError(`Unsupported outcome: ${outcome}`);
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

      const candles = await aggregator.getCandles({
        marketId: id,
        outcome,
        interval,
        from,
        to,
        limit,
      });

      // Add helpful debugging info when no candles found
      const meta: any = {
        marketId: id,
        outcome,
        interval,
        from: from.toISOString(),
        to: to.toISOString(),
        count: candles.length,
      };

      if (candles.length === 0) {
        meta.message =
          'No trading activity in this time range. Candles require real-time data from the WebSocket stream. Try: (1) Wait a few minutes for data to accumulate, (2) Select a market with recent activity, or (3) Expand the time window.';
      }

      return { candles, meta };
    },
  );
}
