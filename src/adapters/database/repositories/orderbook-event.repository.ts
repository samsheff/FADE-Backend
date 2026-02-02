import { PrismaClient, OrderbookEvent as PrismaOrderbookEvent } from '@prisma/client';
import { getPrismaClient } from '../client.js';
import { OrderbookEventRecord } from '../../../types/market-data.types.js';

export class OrderbookEventRepository {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = getPrismaClient();
  }

  async insert(event: OrderbookEventRecord): Promise<OrderbookEventRecord> {
    const saved = await this.prisma.orderbookEvent.create({
      data: {
        marketId: event.marketId,
        outcome: event.outcome,
        bestBid: event.bestBid,
        bestAsk: event.bestAsk,
        midPrice: event.midPrice,
        timestamp: event.timestamp,
      },
    });

    return this.toModel(saved);
  }

  /**
   * Batch insert orderbook events with deduplication
   * @param events - Array of orderbook events to insert
   * @param source - Source of the events ("historical" | "realtime")
   * @returns Number of events actually inserted
   */
  async batchInsert(events: OrderbookEventRecord[], source: 'historical' | 'realtime' = 'realtime'): Promise<number> {
    if (events.length === 0) {
      return 0;
    }

    const batchSize = 1000;
    let totalInserted = 0;

    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);

      // Use createMany for batch insert
      const result = await this.prisma.orderbookEvent.createMany({
        data: batch.map((event) => ({
          marketId: event.marketId,
          outcome: event.outcome,
          bestBid: event.bestBid,
          bestAsk: event.bestAsk,
          midPrice: event.midPrice,
          timestamp: event.timestamp,
          source,
        })),
        skipDuplicates: true,
      });

      totalInserted += result.count;
    }

    return totalInserted;
  }

  async findByMarket(
    marketId: string,
    outcome: string,
    from: Date,
    to: Date,
    limit?: number,
  ): Promise<OrderbookEventRecord[]> {
    const rows = await this.prisma.orderbookEvent.findMany({
      where: {
        marketId,
        outcome,
        timestamp: {
          gte: from,
          lte: to,
        },
      },
      orderBy: {
        timestamp: 'asc',
      },
      take: limit,
    });

    return rows.map((row) => this.toModel(row));
  }

  async findLastBefore(
    marketId: string,
    outcome: string,
    before: Date,
  ): Promise<OrderbookEventRecord | null> {
    const row = await this.prisma.orderbookEvent.findFirst({
      where: {
        marketId,
        outcome,
        timestamp: {
          lt: before,
        },
      },
      orderBy: {
        timestamp: 'desc',
      },
    });

    return row ? this.toModel(row) : null;
  }

  private toModel(event: PrismaOrderbookEvent): OrderbookEventRecord {
    return {
      id: event.id,
      marketId: event.marketId,
      outcome: event.outcome as OrderbookEventRecord['outcome'],
      bestBid: event.bestBid ? event.bestBid.toString() : null,
      bestAsk: event.bestAsk ? event.bestAsk.toString() : null,
      midPrice: event.midPrice ? event.midPrice.toString() : null,
      timestamp: event.timestamp,
    };
  }
}
