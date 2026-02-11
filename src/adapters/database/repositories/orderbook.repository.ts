import { PrismaClient, OrderbookSnapshot as PrismaOrderbookSnapshot } from '@prisma/client';
import { getPrismaClient } from '../client.js';
import { OrderbookSnapshot } from '../../../types/market.types.js';
import { toJsonValue } from '../../../utils/prisma-json.js';

export class OrderbookRepository {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = getPrismaClient();
  }

  async findFreshSnapshot(
    marketId: string,
    outcome: string,
    now: Date,
  ): Promise<OrderbookSnapshot | null> {
    const snapshot = await this.prisma.orderbookSnapshot.findFirst({
      where: {
        marketId,
        outcome,
        expiresAt: { gt: now },
      },
    });

    return snapshot ? this.toModel(snapshot) : null;
  }

  async upsertSnapshot(snapshot: Omit<OrderbookSnapshot, 'timestamp'>): Promise<OrderbookSnapshot> {
    const saved = await this.prisma.orderbookSnapshot.upsert({
      where: {
        marketId_outcome: {
          marketId: snapshot.marketId,
          outcome: snapshot.outcome,
        },
      },
      create: {
        marketId: snapshot.marketId,
        outcome: snapshot.outcome,
        bids: toJsonValue(snapshot.bids),
        asks: toJsonValue(snapshot.asks),
        expiresAt: snapshot.expiresAt,
      },
      update: {
        bids: toJsonValue(snapshot.bids),
        asks: toJsonValue(snapshot.asks),
        expiresAt: snapshot.expiresAt,
      },
    });

    return this.toModel(saved);
  }

  async deleteSnapshot(marketId: string, outcome: string): Promise<void> {
    await this.prisma.orderbookSnapshot.deleteMany({
      where: { marketId, outcome },
    });
  }

  private toModel(prismaSnapshot: PrismaOrderbookSnapshot): OrderbookSnapshot {
    return {
      marketId: prismaSnapshot.marketId,
      outcome: prismaSnapshot.outcome,
      bids: prismaSnapshot.bids as OrderbookSnapshot['bids'],
      asks: prismaSnapshot.asks as OrderbookSnapshot['asks'],
      timestamp: prismaSnapshot.timestamp,
      expiresAt: prismaSnapshot.expiresAt,
    };
  }
}
