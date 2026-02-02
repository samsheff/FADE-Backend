import { PrismaClient, TradeEvent as PrismaTradeEvent } from '@prisma/client';
import { getPrismaClient } from '../client.js';
import { TradeEventRecord } from '../../../types/market-data.types.js';

export class TradeEventRepository {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = getPrismaClient();
  }

  async insert(event: TradeEventRecord): Promise<TradeEventRecord> {
    const saved = await this.prisma.tradeEvent.create({
      data: {
        marketId: event.marketId,
        outcome: event.outcome,
        price: event.price,
        size: event.size,
        timestamp: event.timestamp,
      },
    });

    return this.toModel(saved);
  }

  /**
   * Batch insert trade events with deduplication
   * Uses raw SQL with ON CONFLICT DO NOTHING for idempotency
   * @param events - Array of trade events to insert
   * @param source - Source of the events ("historical" | "realtime")
   * @returns Number of events actually inserted
   */
  async batchInsert(events: TradeEventRecord[], source: 'historical' | 'realtime' = 'realtime'): Promise<number> {
    if (events.length === 0) {
      return 0;
    }

    const batchSize = 1000;
    let totalInserted = 0;

    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);

      // Use createMany with skipDuplicates for deduplication
      const result = await this.prisma.tradeEvent.createMany({
        data: batch.map((event) => ({
          marketId: event.marketId,
          outcome: event.outcome,
          price: event.price,
          size: event.size,
          timestamp: event.timestamp,
          source,
        })),
        skipDuplicates: true, // Skip records that violate unique constraint
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
  ): Promise<TradeEventRecord[]> {
    const rows = await this.prisma.tradeEvent.findMany({
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

  private toModel(event: PrismaTradeEvent): TradeEventRecord {
    return {
      id: event.id,
      marketId: event.marketId,
      outcome: event.outcome as TradeEventRecord['outcome'],
      price: event.price.toString(),
      size: event.size.toString(),
      timestamp: event.timestamp,
    };
  }
}
