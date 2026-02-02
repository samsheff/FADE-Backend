import { getLogger } from '../../utils/logger.js';
import { getEnvironment } from '../../config/environment.js';
import { PolymarketDataApiAdapter, HistoricalTrade } from '../../adapters/polymarket/data-api.adapter.js';
import { TradeEventRepository } from '../../adapters/database/repositories/trade-event.repository.js';
import { OrderbookEventRepository } from '../../adapters/database/repositories/orderbook-event.repository.js';
import { MarketBackfillRepository } from '../../adapters/database/repositories/market-backfill.repository.js';
import { TradeEventRecord, OrderbookEventRecord } from '../../types/market-data.types.js';

export interface BackfillOptions {
  skipIfCompleted?: boolean;
  synthesizeOrderbookEvents?: boolean;
}

export class HistoricalMarketDataSync {
  private logger;
  private dataApi: PolymarketDataApiAdapter;
  private tradeEventRepo: TradeEventRepository;
  private orderbookEventRepo: OrderbookEventRepository;
  private backfillRepo: MarketBackfillRepository;
  private rateLimitMs: number;
  private batchSize: number;

  constructor() {
    const env = getEnvironment();
    this.logger = getLogger();
    this.dataApi = new PolymarketDataApiAdapter();
    this.tradeEventRepo = new TradeEventRepository();
    this.orderbookEventRepo = new OrderbookEventRepository();
    this.backfillRepo = new MarketBackfillRepository();
    this.rateLimitMs = env.HISTORICAL_BACKFILL_RATE_LIMIT_MS;
    this.batchSize = env.HISTORICAL_BACKFILL_BATCH_SIZE;
  }

  /**
   * Backfill historical data for a single market
   * @param marketId - Market condition ID
   * @param options - Backfill options
   */
  async backfillMarket(marketId: string, options: BackfillOptions = {}): Promise<void> {
    const { skipIfCompleted = true, synthesizeOrderbookEvents = false } = options;

    this.logger.info({ marketId }, 'Starting historical backfill for market');

    try {
      // Check if already backfilled
      const existing = await this.backfillRepo.findById(marketId);
      if (existing && existing.status === 'completed' && skipIfCompleted) {
        this.logger.info({ marketId }, 'Market already backfilled, skipping');
        return;
      }

      // Mark as in progress
      await this.updateBackfillStatus(marketId, 'in_progress', {
        startedAt: new Date(),
        errorMessage: null,
      });

      // Fetch historical trades
      const trades = await this.fetchHistoricalTrades(marketId);

      if (trades.length === 0) {
        this.logger.warn({ marketId }, 'No historical trades found for market');
        await this.updateBackfillStatus(marketId, 'completed', {
          completedAt: new Date(),
          tradeEventsCount: 0,
        });
        return;
      }

      // Convert to TradeEventRecords
      const tradeEvents = trades.map((trade) => this.toTradeEventRecord(trade));

      // Batch insert trades
      const insertedCount = await this.batchInsertTradeEvents(tradeEvents);

      // Calculate timestamps
      const timestamps = trades.map((t) => t.timestamp.getTime());
      const earliestTimestamp = new Date(Math.min(...timestamps));
      const latestTimestamp = new Date(Math.max(...timestamps));

      let orderbookEventCount = 0;
      // Optionally synthesize orderbook events
      if (synthesizeOrderbookEvents) {
        const orderbookEvents = this.synthesizeOrderbookEvents(trades);
        orderbookEventCount = await this.batchInsertOrderbookEvents(orderbookEvents);
      }

      // Mark as completed
      await this.updateBackfillStatus(marketId, 'completed', {
        completedAt: new Date(),
        tradeEventsCount: insertedCount,
        orderbookEventsCount: orderbookEventCount,
        earliestTimestamp,
        latestTimestamp,
      });

      this.logger.info(
        {
          marketId,
          tradeEventsCount: insertedCount,
          orderbookEventsCount: orderbookEventCount,
          earliestTimestamp,
          latestTimestamp,
        },
        'Completed historical backfill for market',
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ error, marketId }, 'Failed to backfill market');

      await this.updateBackfillStatus(marketId, 'failed', {
        errorMessage,
      });

      throw error;
    }
  }

  /**
   * Backfill all markets that don't have completed backfill
   * @param options - Backfill options
   */
  async backfillAllMarkets(options: BackfillOptions = {}): Promise<void> {
    this.logger.info('Starting backfill for all markets');

    // Find all pending/failed backfills
    const pendingBackfills = await this.backfillRepo.findByStatus('pending');
    const failedBackfills = await this.backfillRepo.findByStatus('failed');
    const marketsToBackfill = [...pendingBackfills, ...failedBackfills];

    this.logger.info(
      { count: marketsToBackfill.length },
      'Found markets to backfill',
    );

    for (const backfill of marketsToBackfill) {
      try {
        await this.backfillMarket(backfill.marketId, options);
      } catch (error) {
        this.logger.warn(
          { error, marketId: backfill.marketId },
          'Failed to backfill market, continuing with next',
        );
        // Continue with next market even if one fails
      }
    }

    this.logger.info('Completed backfill for all markets');
  }

  /**
   * Backfill specific new markets (triggered on market discovery)
   * @param marketIds - Array of market IDs to backfill
   * @param options - Backfill options
   */
  async backfillNewMarkets(marketIds: string[], options: BackfillOptions = {}): Promise<void> {
    if (marketIds.length === 0) {
      return;
    }

    this.logger.info({ marketIds, count: marketIds.length }, 'Starting backfill for new markets');

    for (const marketId of marketIds) {
      try {
        // Create pending backfill record if it doesn't exist
        const existing = await this.backfillRepo.findById(marketId);
        if (!existing) {
          await this.backfillRepo.upsert({
            marketId,
            status: 'pending',
          });
        }

        await this.backfillMarket(marketId, options);
      } catch (error) {
        this.logger.warn(
          { error, marketId },
          'Failed to backfill new market, continuing with next',
        );
        // Continue with next market
      }
    }
  }

  /**
   * Fetch historical trades from Data API with pagination
   * @param marketId - Market condition ID
   * @returns Array of historical trades
   */
  private async fetchHistoricalTrades(marketId: string): Promise<HistoricalTrade[]> {
    this.logger.debug({ marketId }, 'Fetching historical trades from Data API');

    const allTrades: HistoricalTrade[] = [];
    let offset = 0;

    while (true) {
      const trades = await this.dataApi.fetchTrades({
        market: marketId,
        limit: this.batchSize,
        offset,
      });

      allTrades.push(...trades);

      this.logger.debug(
        {
          marketId,
          offset,
          batchSize: trades.length,
          totalTrades: allTrades.length,
        },
        'Fetched trade batch',
      );

      // If we got fewer trades than batch size, we've reached the end
      if (trades.length < this.batchSize) {
        break;
      }

      offset += this.batchSize;

      // Rate limiting between requests
      await new Promise((resolve) => setTimeout(resolve, this.rateLimitMs));
    }

    return allTrades;
  }

  /**
   * Batch insert trade events with deduplication
   * @param events - Array of trade events
   * @returns Number of events inserted
   */
  private async batchInsertTradeEvents(events: TradeEventRecord[]): Promise<number> {
    if (events.length === 0) {
      return 0;
    }

    this.logger.debug({ count: events.length }, 'Batch inserting trade events');

    const inserted = await this.tradeEventRepo.batchInsert(events, 'historical');

    this.logger.debug(
      { total: events.length, inserted },
      'Completed batch insert of trade events',
    );

    return inserted;
  }

  /**
   * Batch insert orderbook events
   * @param events - Array of orderbook events
   * @returns Number of events inserted
   */
  private async batchInsertOrderbookEvents(events: OrderbookEventRecord[]): Promise<number> {
    if (events.length === 0) {
      return 0;
    }

    this.logger.debug({ count: events.length }, 'Batch inserting orderbook events');

    const inserted = await this.orderbookEventRepo.batchInsert(events, 'historical');

    this.logger.debug(
      { total: events.length, inserted },
      'Completed batch insert of orderbook events',
    );

    return inserted;
  }

  /**
   * Synthesize orderbook events from trades
   * Creates orderbook snapshots by grouping trades by time windows
   * @param trades - Array of historical trades
   * @returns Array of orderbook events
   */
  private synthesizeOrderbookEvents(trades: HistoricalTrade[]): OrderbookEventRecord[] {
    if (trades.length === 0) {
      return [];
    }

    // Group trades by market, outcome, and 1-minute windows
    const windows = new Map<string, HistoricalTrade[]>();

    for (const trade of trades) {
      // Round timestamp to 1-minute window
      const windowTime = new Date(Math.floor(trade.timestamp.getTime() / 60000) * 60000);
      const key = `${trade.conditionId}:${trade.outcome}:${windowTime.getTime()}`;

      if (!windows.has(key)) {
        windows.set(key, []);
      }
      windows.get(key)!.push(trade);
    }

    // Create orderbook events from windows
    const events: OrderbookEventRecord[] = [];

    for (const [key, windowTrades] of windows.entries()) {
      const [marketId, outcome, timestampStr] = key.split(':');
      const timestamp = new Date(parseInt(timestampStr, 10));

      // Calculate best bid/ask from trades (simplified)
      // In reality, we'd need actual orderbook data, but we approximate from trades
      const prices = windowTrades.map((t) => parseFloat(t.price));
      const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;

      events.push({
        id: `${key}`,
        marketId,
        outcome: outcome as 'YES' | 'NO',
        bestBid: (avgPrice * 0.99).toFixed(4), // Approximate bid as 1% below avg
        bestAsk: (avgPrice * 1.01).toFixed(4), // Approximate ask as 1% above avg
        midPrice: avgPrice.toFixed(4),
        timestamp,
      });
    }

    return events;
  }

  /**
   * Update backfill status in database
   * @param marketId - Market ID
   * @param status - New status
   * @param updates - Additional fields to update
   */
  private async updateBackfillStatus(
    marketId: string,
    status: 'pending' | 'in_progress' | 'completed' | 'failed',
    updates: Partial<{
      tradeEventsCount: number;
      orderbookEventsCount: number;
      earliestTimestamp: Date;
      latestTimestamp: Date;
      errorMessage: string;
      startedAt: Date;
      completedAt: Date;
    }> = {},
  ): Promise<void> {
    await this.backfillRepo.upsert({
      marketId,
      status,
      ...updates,
    });
  }

  /**
   * Convert HistoricalTrade to TradeEventRecord
   * @param trade - Historical trade
   * @returns Trade event record
   */
  private toTradeEventRecord(trade: HistoricalTrade): TradeEventRecord {
    return {
      id: `${trade.conditionId}:${trade.outcome}:${trade.timestamp.getTime()}:${trade.price}:${trade.size}`,
      marketId: trade.conditionId,
      outcome: trade.outcome.toUpperCase() as 'YES' | 'NO',
      price: trade.price,
      size: trade.size,
      timestamp: trade.timestamp,
    };
  }
}
