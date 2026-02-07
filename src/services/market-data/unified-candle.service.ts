/**
 * UnifiedCandleService - Polymorphic candle service
 *
 * Handles candles for both:
 * - Markets: on-demand aggregation from OrderbookEvent (existing logic)
 * - Instruments: TradingView + DB caching (new logic)
 */

import { CandleAggregator } from './candle-aggregator.service.js';
import { TradingViewDataService } from './tradingview-data.service.js';
import { CandleRepository } from '../../adapters/database/repositories/candle.repository.js';
import { InstrumentRepository } from '../../adapters/database/repositories/instrument.repository.js';
import { CandleInterval, MarketOutcome } from '../../types/market-data.types.js';
import { getLogger } from '../../utils/logger.js';

interface UnifiedCandleParams {
  // Polymorphic: exactly one must be provided
  marketId?: string;
  instrumentId?: string;

  // Market-specific
  outcome?: MarketOutcome;

  // Common
  interval: CandleInterval;
  from: Date;
  to: Date;
  limit?: number;
}

interface CandleOutput {
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string | null;
  startTime: Date;
  endTime: Date;
}

export class UnifiedCandleService {
  private candleAggregator: CandleAggregator;
  private tradingViewData: TradingViewDataService;
  private candleRepo: CandleRepository;
  private instrumentRepo: InstrumentRepository;
  private inflightRequests: Map<string, Promise<CandleOutput[]>> = new Map();

  private get logger() {
    return getLogger();
  }

  constructor() {
    this.candleAggregator = new CandleAggregator();
    this.tradingViewData = new TradingViewDataService();
    this.candleRepo = new CandleRepository();
    this.instrumentRepo = new InstrumentRepository();
  }

  async getCandles(params: UnifiedCandleParams): Promise<CandleOutput[]> {
    // Route to appropriate handler based on entity type
    if (params.marketId) {
      return this.getMarketCandles(params);
    }

    if (params.instrumentId) {
      return this.getInstrumentCandles(params);
    }

    throw new Error('Either marketId or instrumentId must be provided');
  }

  /**
   * Market candles: use existing on-demand aggregation from OrderbookEvent
   */
  private async getMarketCandles(params: UnifiedCandleParams): Promise<CandleOutput[]> {
    const { marketId, outcome, interval, from, to, limit } = params;

    if (!marketId) {
      throw new Error('marketId is required for market candles');
    }

    if (!outcome) {
      throw new Error('outcome is required for market candles');
    }

    this.logger.debug({ marketId, outcome, interval }, 'Fetching market candles (on-demand aggregation)');

    const candles = await this.candleAggregator.getCandles({
      marketId,
      outcome,
      interval,
      from,
      to,
      limit,
    });

    return candles;
  }

  /**
   * Instrument candles: fetch from TradingView, cache in DB
   * Uses request coalescing to prevent duplicate concurrent fetches
   */
  private async getInstrumentCandles(params: UnifiedCandleParams): Promise<CandleOutput[]> {
    const { instrumentId, interval, from, to, limit } = params;

    if (!instrumentId) {
      throw new Error('instrumentId is required for instrument candles');
    }

    // Create a unique key for this request
    const requestKey = `${instrumentId}_${interval}_${from.getTime()}_${to.getTime()}`;

    // Check if this request is already in-flight
    const inflightRequest = this.inflightRequests.get(requestKey);
    if (inflightRequest) {
      this.logger.debug({ instrumentId, interval }, 'Coalescing duplicate concurrent request');
      return inflightRequest;
    }

    // Start the request and store the promise
    const requestPromise = this.fetchInstrumentCandlesImpl(params);

    this.inflightRequests.set(requestKey, requestPromise);

    try {
      const result = await requestPromise;
      return result;
    } finally {
      // Clean up the in-flight request after completion
      this.inflightRequests.delete(requestKey);
    }
  }

  /**
   * Internal implementation of instrument candle fetching
   */
  private async fetchInstrumentCandlesImpl(params: UnifiedCandleParams): Promise<CandleOutput[]> {
    const { instrumentId, interval, from, to, limit } = params;

    if (!instrumentId) {
      throw new Error('instrumentId is required for instrument candles');
    }

    this.logger.debug({ instrumentId, interval, from, to }, 'Fetching instrument candles');

    // 1. Check DB cache first
    let cachedCandles = await this.candleRepo.findByInstrument({
      instrumentId,
      interval,
      from,
      to,
    });

    // 2. If cache is complete, return it
    if (this.isCacheComplete(cachedCandles, interval, from, to)) {
      this.logger.debug(
        { instrumentId, count: cachedCandles.length },
        'Returning candles from cache (complete)',
      );
      return this.normalizePrismaCandles(cachedCandles, limit);
    }

    // 3. Cache is incomplete or empty - fetch from TradingView
    this.logger.debug({ instrumentId }, 'Cache incomplete, fetching from TradingView');

    const instrument = await this.instrumentRepo.findById(instrumentId);
    if (!instrument) {
      throw new Error(`Instrument not found: ${instrumentId}`);
    }

    const tvCandles = await this.tradingViewData.fetchHistoricalCandles(
      instrumentId,
      instrument.symbol,
      interval,
      from,
      to,
    );

    // 4. Backfill cache with TradingView data
    if (tvCandles.length > 0) {
      await this.candleRepo.upsertCandles(tvCandles);
      this.logger.debug({ instrumentId, count: tvCandles.length }, 'Backfilled cache with TradingView data');
    }

    // 5. Re-query cache to get merged result
    const mergedCandles = await this.candleRepo.findByInstrument({
      instrumentId,
      interval,
      from,
      to,
    });

    return this.normalizePrismaCandles(mergedCandles, limit);
  }

  /**
   * Check if cached candles cover the entire requested range
   * Simple heuristic: if we have candles and they span the range, consider it complete
   */
  private isCacheComplete(
    candles: Array<{ timestamp: Date; endTime: Date }>,
    interval: string,
    from: Date,
    to: Date,
  ): boolean {
    if (candles.length === 0) {
      return false;
    }

    const firstCandle = candles[0];
    const lastCandle = candles[candles.length - 1];

    // Check if cache boundaries cover the requested range
    const coverageOk = firstCandle.timestamp <= from && lastCandle.endTime >= to;

    // For short intervals, also check density (no large gaps)
    if (interval === '1m' || interval === '5m') {
      const maxGap = this.getMaxAllowedGap(interval);
      for (let i = 1; i < candles.length; i++) {
        const gap = candles[i].timestamp.getTime() - candles[i - 1].endTime.getTime();
        if (gap > maxGap) {
          this.logger.debug({ gap, maxGap }, 'Cache has gaps');
          return false;
        }
      }
    }

    return coverageOk;
  }

  /**
   * Maximum allowed gap between candles (in ms) before considering cache incomplete
   */
  private getMaxAllowedGap(interval: string): number {
    const intervalMs = this.intervalToMs(interval);
    // Allow up to 3x the interval duration as a gap (to account for market hours)
    return intervalMs * 3;
  }

  private intervalToMs(interval: string): number {
    const mapping: Record<string, number> = {
      '1m': 60_000,
      '5m': 300_000,
      '15m': 900_000,
      '1h': 3_600_000,
      '1d': 86_400_000,
    };
    return mapping[interval] || 60_000;
  }

  /**
   * Convert Prisma candles to output format
   */
  private normalizePrismaCandles(
    candles: Array<{
      open: any;
      high: any;
      low: any;
      close: any;
      volume: any;
      timestamp: Date;
      endTime: Date;
    }>,
    limit?: number,
  ): CandleOutput[] {
    const normalized = candles.map((c) => ({
      open: c.open.toString(),
      high: c.high.toString(),
      low: c.low.toString(),
      close: c.close.toString(),
      volume: c.volume ? c.volume.toString() : '0',
      startTime: c.timestamp,
      endTime: c.endTime,
    }));

    if (limit && normalized.length > limit) {
      return normalized.slice(normalized.length - limit);
    }

    return normalized;
  }
}
