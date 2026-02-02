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
