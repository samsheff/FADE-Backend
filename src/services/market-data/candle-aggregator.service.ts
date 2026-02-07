import { OrderbookEventRepository } from '../../adapters/database/repositories/orderbook-event.repository.js';
import { TradeEventRepository } from '../../adapters/database/repositories/trade-event.repository.js';
import { Candle, CandleInterval, MarketOutcome, OrderbookEventRecord, TradeEventRecord } from '../../types/market-data.types.js';
import { getLogger } from '../../utils/logger.js';

const INTERVAL_MS: Record<CandleInterval, number> = {
  '1s': 1000,
  '5s': 5000,
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
};

export class CandleAggregator {
  private orderbookRepo: OrderbookEventRepository;
  private tradeRepo: TradeEventRepository;
  private logger = getLogger();

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

    // Align boundaries to interval grid so buckets are deterministic.
    const alignedFrom = Math.floor(from.getTime() / intervalMs) * intervalMs;
    const alignedTo = Math.floor(to.getTime() / intervalMs) * intervalMs;

    // Fetch one extra bucket before alignedFrom to seed the forward-fill
    // when the first requested bucket has no events.
    const seedFrom = new Date(alignedFrom - intervalMs);

    // Fetch both sources in parallel — never pick one exclusively.
    // Per-bucket logic below chooses which source to use for each candle,
    // ensuring trade and quote timestamps are never mixed within a single candle.
    const [orderbookEvents, tradeEvents] = await Promise.all([
      this.orderbookRepo.findByMarket(marketId, outcome, seedFrom, to),
      this.tradeRepo.findByMarket(marketId, outcome, seedFrom, to),
    ]);

    // Index events into bucket maps for O(1) lookup per interval.
    const obByBucket = this.indexIntoBuckets(orderbookEvents, intervalMs);
    const tradesByBucket = this.indexIntoBuckets(tradeEvents, intervalMs);

    // Seed: extract the most recent price from the bucket before alignedFrom.
    let lastClose: string | null = this.extractSeedPrice(
      obByBucket.get(alignedFrom - intervalMs),
      tradesByBucket.get(alignedFrom - intervalMs),
    );

    // Walk every bucket in [alignedFrom, alignedTo], emitting one candle per bucket.
    const candles: Candle[] = [];
    for (let t = alignedFrom; t <= alignedTo; t += intervalMs) {
      const obEvents = obByBucket.get(t);
      const trades = tradesByBucket.get(t);

      let prices: number[] = [];
      let volume = 0;

      if (obEvents && obEvents.length > 0) {
        // Priority chain per event: midPrice > bestBid > bestAsk.
        // Orderbook source — no fill volume available.
        prices = obEvents
          .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
          .map((e) => {
            const mid = e.midPrice ? Number(e.midPrice) : NaN;
            const bid = e.bestBid ? Number(e.bestBid) : NaN;
            const ask = e.bestAsk ? Number(e.bestAsk) : NaN;
            // Return first non-NaN in priority order.
            return Number.isNaN(mid) ? (Number.isNaN(bid) ? ask : bid) : mid;
          })
          .filter((p) => !Number.isNaN(p));
      } else if (trades && trades.length > 0) {
        // Fall back to trade prices only when no orderbook data exists
        // for this bucket — keeps quote and trade timestamps separated.
        const sorted = trades.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        prices = sorted.map((e) => Number(e.price)).filter((p) => !Number.isNaN(p));
        volume = sorted.reduce((sum, e) => sum + (Number(e.size) || 0), 0);
      }

      if (prices.length > 0) {
        const open = prices[0];
        const close = prices[prices.length - 1];
        const high = Math.max(...prices);
        const low = Math.min(...prices);

        candles.push({
          marketId,
          outcome,
          interval,
          open: open.toString(),
          high: high.toString(),
          low: low.toString(),
          close: close.toString(),
          volume: volume > 0 ? volume.toString() : '0',
          startTime: new Date(t),
          endTime: new Date(t + intervalMs),
        });
        lastClose = close.toString();
      } else if (lastClose !== null) {
        // No events in this bucket — forward-fill with previous close.
        // O=H=L=C=lastClose, volume=0.  Chart renders a flat doji.
        candles.push({
          marketId,
          outcome,
          interval,
          open: lastClose,
          high: lastClose,
          low: lastClose,
          close: lastClose,
          volume: '0',
          startTime: new Date(t),
          endTime: new Date(t + intervalMs),
        });
        // lastClose unchanged — subsequent empty buckets chain from the same value.
      }
      // If lastClose is still null (no seed, no events yet), skip the bucket.
      // This can only happen for leading buckets before any price data exists.
    }

    this.logger.debug(
      {
        marketId: marketId.slice(0, 8),
        outcome,
        interval,
        totalBuckets: Math.floor((alignedTo - alignedFrom) / intervalMs) + 1,
        candlesEmitted: candles.length,
        orderbookEvents: orderbookEvents.length,
        tradeEvents: tradeEvents.length,
      },
      'Candle aggregation complete',
    );

    if (limit && candles.length > limit) {
      return candles.slice(candles.length - limit);
    }

    return candles;
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private indexIntoBuckets<T extends { timestamp: Date }>(
    events: T[],
    intervalMs: number,
  ): Map<number, T[]> {
    const map = new Map<number, T[]>();
    for (const event of events) {
      const bucket = Math.floor(event.timestamp.getTime() / intervalMs) * intervalMs;
      const list = map.get(bucket);
      if (list) {
        list.push(event);
      } else {
        map.set(bucket, [event]);
      }
    }
    return map;
  }

  private extractSeedPrice(
    obEvents: OrderbookEventRecord[] | undefined,
    trades: TradeEventRecord[] | undefined,
  ): string | null {
    // Try orderbook first (midPrice > bestBid > bestAsk), then trades.
    if (obEvents && obEvents.length > 0) {
      const sorted = [...obEvents].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      const last = sorted[sorted.length - 1];
      return last.midPrice ?? last.bestBid ?? last.bestAsk ?? null;
    }
    if (trades && trades.length > 0) {
      const sorted = [...trades].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      return sorted[sorted.length - 1].price;
    }
    return null;
  }
}
