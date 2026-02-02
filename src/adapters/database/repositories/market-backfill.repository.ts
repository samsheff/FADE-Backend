import { PrismaClient, MarketBackfill as PrismaMarketBackfill } from '@prisma/client';
import { getPrismaClient } from '../client.js';

export interface MarketBackfillRecord {
  marketId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  tradeEventsCount: number;
  orderbookEventsCount: number;
  earliestTimestamp: Date | null;
  latestTimestamp: Date | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class MarketBackfillRepository {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = getPrismaClient();
  }

  async findById(marketId: string): Promise<MarketBackfillRecord | null> {
    const record = await this.prisma.marketBackfill.findUnique({
      where: { marketId },
    });

    return record ? this.toModel(record) : null;
  }

  async findByStatus(status: MarketBackfillRecord['status']): Promise<MarketBackfillRecord[]> {
    const records = await this.prisma.marketBackfill.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
    });

    return records.map((record) => this.toModel(record));
  }

  async findAll(): Promise<MarketBackfillRecord[]> {
    const records = await this.prisma.marketBackfill.findMany({
      orderBy: { updatedAt: 'desc' },
    });

    return records.map((record) => this.toModel(record));
  }

  async upsert(backfill: Partial<MarketBackfillRecord> & { marketId: string }): Promise<MarketBackfillRecord> {
    const saved = await this.prisma.marketBackfill.upsert({
      where: { marketId: backfill.marketId },
      create: {
        marketId: backfill.marketId,
        status: backfill.status || 'pending',
        tradeEventsCount: backfill.tradeEventsCount || 0,
        orderbookEventsCount: backfill.orderbookEventsCount || 0,
        earliestTimestamp: backfill.earliestTimestamp || null,
        latestTimestamp: backfill.latestTimestamp || null,
        errorMessage: backfill.errorMessage || null,
        startedAt: backfill.startedAt || null,
        completedAt: backfill.completedAt || null,
      },
      update: {
        status: backfill.status,
        tradeEventsCount: backfill.tradeEventsCount,
        orderbookEventsCount: backfill.orderbookEventsCount,
        earliestTimestamp: backfill.earliestTimestamp,
        latestTimestamp: backfill.latestTimestamp,
        errorMessage: backfill.errorMessage,
        startedAt: backfill.startedAt,
        completedAt: backfill.completedAt,
      },
    });

    return this.toModel(saved);
  }

  private toModel(record: PrismaMarketBackfill): MarketBackfillRecord {
    return {
      marketId: record.marketId,
      status: record.status as MarketBackfillRecord['status'],
      tradeEventsCount: record.tradeEventsCount,
      orderbookEventsCount: record.orderbookEventsCount,
      earliestTimestamp: record.earliestTimestamp,
      latestTimestamp: record.latestTimestamp,
      errorMessage: record.errorMessage,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
