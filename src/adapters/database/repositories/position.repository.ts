import { PrismaClient, Position as PrismaPosition } from '@prisma/client';
import { Position } from '../../../types/position.types.js';
import { Outcome } from '../../../types/trade.types.js';
import { getPrismaClient } from '../client.js';

export class PositionRepository {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = getPrismaClient();
  }

  async findByWallet(walletAddress?: string): Promise<Position[]> {
    const positions = await this.prisma.position.findMany({
      where: walletAddress ? { walletAddress } : undefined,
      orderBy: { updatedAt: 'desc' },
    });

    return positions.map((p) => this.toModel(p));
  }

  async findAll(): Promise<Position[]> {
    const positions = await this.prisma.position.findMany({
      orderBy: { updatedAt: 'desc' },
    });

    return positions.map((p) => this.toModel(p));
  }

  async findOne(
    walletAddress: string,
    marketId: string,
    outcome: Outcome,
  ): Promise<Position | null> {
    const position = await this.prisma.position.findUnique({
      where: {
        walletAddress_marketId_outcome: {
          walletAddress,
          marketId,
          outcome,
        },
      },
    });

    return position ? this.toModel(position) : null;
  }

  async upsert(
    walletAddress: string,
    marketId: string,
    outcome: Outcome,
    data: {
      avgPrice: string;
      size: string;
      realizedPnl?: string;
      unrealizedPnl?: string;
    },
  ): Promise<Position> {
    const now = new Date();

    const upserted = await this.prisma.position.upsert({
      where: {
        walletAddress_marketId_outcome: {
          walletAddress,
          marketId,
          outcome,
        },
      },
      create: {
        walletAddress,
        marketId,
        outcome,
        avgPrice: data.avgPrice,
        size: data.size,
        realizedPnl: data.realizedPnl || '0',
        unrealizedPnl: data.unrealizedPnl || '0',
        lastTradeAt: now,
      },
      update: {
        avgPrice: data.avgPrice,
        size: data.size,
        ...(data.realizedPnl !== undefined && { realizedPnl: data.realizedPnl }),
        ...(data.unrealizedPnl !== undefined && { unrealizedPnl: data.unrealizedPnl }),
        lastTradeAt: now,
      },
    });

    return this.toModel(upserted);
  }

  async updateUnrealizedPnl(
    walletAddress: string,
    marketId: string,
    outcome: Outcome,
    unrealizedPnl: string,
  ): Promise<Position | null> {
    const updated = await this.prisma.position.update({
      where: {
        walletAddress_marketId_outcome: {
          walletAddress,
          marketId,
          outcome,
        },
      },
      data: {
        unrealizedPnl,
      },
    });

    return this.toModel(updated);
  }

  private toModel(prismaPosition: PrismaPosition): Position {
    return {
      walletAddress: prismaPosition.walletAddress,
      marketId: prismaPosition.marketId,
      outcome: prismaPosition.outcome as Outcome,
      avgPrice: prismaPosition.avgPrice.toString(),
      size: prismaPosition.size.toString(),
      realizedPnl: prismaPosition.realizedPnl.toString(),
      unrealizedPnl: prismaPosition.unrealizedPnl.toString(),
      lastTradeAt: prismaPosition.lastTradeAt,
      updatedAt: prismaPosition.updatedAt,
    };
  }
}
