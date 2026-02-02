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
