import { OrderbookEventRepository } from '../../adapters/database/repositories/orderbook-event.repository.js';
import { TradeEventRepository } from '../../adapters/database/repositories/trade-event.repository.js';
import { Candle, CandleInterval, MarketOutcome } from '../../types/market-data.types.js';

const INTERVAL_MS: Record<CandleInterval, number> = {
  '1s': 1000,
  '5s': 5000,
  '1m': 60_000,
  '5m': 300_000,
  '1h': 3_600_000,
};

type CandleSourceEvent = {
  price: string;
  timestamp: Date;
};

export class CandleAggregator {
  private orderbookRepo: OrderbookEventRepository;
  private tradeRepo: TradeEventRepository;

  constructor() {
    this.orderbookRepo = new OrderbookEventRepository();
    this.tradeRepo = new TradeEventRepository();
  }

  async getCandles(params: {
    marketId: string;
    outcome: MarketOutcome;
    interval: CandleInterval;
    from: Date;
    to: Date;
    limit?: number;
  }): Promise<Candle[]> {
    const { marketId, outcome, interval, from, to, limit } = params;
    const intervalMs = INTERVAL_MS[interval];

    const tradeEvents = await this.tradeRepo.findByMarket(marketId, outcome, from, to);
    const events: CandleSourceEvent[] =
      tradeEvents.length > 0
        ? tradeEvents.map((trade) => ({ price: trade.price, timestamp: trade.timestamp }))
        : (
            await this.orderbookRepo.findByMarket(marketId, outcome, from, to)
          )
            .filter((event) => event.midPrice)
            .map((event) => ({
              price: event.midPrice as string,
              timestamp: event.timestamp,
            }));

    if (events.length === 0) {
      return [];
    }

    const buckets = new Map<number, CandleSourceEvent[]>();
    for (const event of events) {
      const bucketStart = Math.floor(event.timestamp.getTime() / intervalMs) * intervalMs;
      const bucket = buckets.get(bucketStart);
      if (bucket) {
        bucket.push(event);
      } else {
        buckets.set(bucketStart, [event]);
      }
    }

    const candles: Candle[] = Array.from(buckets.entries())
      .sort(([a], [b]) => a - b)
      .map(([bucketStart, bucketEvents]) => {
        const sorted = bucketEvents.sort(
          (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
        );
        const prices = sorted.map((event) => Number(event.price)).filter((price) => {
          return !Number.isNaN(price);
        });

        if (prices.length === 0) {
          return null;
        }

        const open = prices[0];
        const close = prices[prices.length - 1];
        const high = Math.max(...prices);
        const low = Math.min(...prices);

        return {
          marketId,
          outcome,
          interval,
          open: open.toString(),
          high: high.toString(),
          low: low.toString(),
          close: close.toString(),
          volume: null,
          startTime: new Date(bucketStart),
          endTime: new Date(bucketStart + intervalMs),
        } satisfies Candle;
      })
      .filter((candle): candle is Candle => candle !== null);

    if (limit && candles.length > limit) {
      return candles.slice(candles.length - limit);
    }

    return candles;
  }
}
