import { PrismaClient, Trade as PrismaTrade } from '@prisma/client';
import { Trade } from '../../../types/trade.types.js';
import { getPrismaClient } from '../client.js';

export class TradeRepository {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = getPrismaClient();
  }

  async findById(id: string): Promise<Trade | null> {
    const trade = await this.prisma.trade.findUnique({
      where: { id },
    });

    return trade ? this.toModel(trade) : null;
  }

  async findByWallet(walletAddress: string): Promise<Trade[]> {
    const trades = await this.prisma.trade.findMany({
      where: { walletAddress },
      orderBy: { timestamp: 'desc' },
    });

    return trades.map((t) => this.toModel(t));
  }

  async findByMarket(marketId: string): Promise<Trade[]> {
    const trades = await this.prisma.trade.findMany({
      where: { marketId },
      orderBy: { timestamp: 'desc' },
    });

    return trades.map((t) => this.toModel(t));
  }

  async findLatestTimestampByWallet(walletAddress: string): Promise<Date | null> {
    const trade = await this.prisma.trade.findFirst({
      where: { walletAddress },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    });

    return trade?.timestamp ?? null;
  }

  async create(trade: Omit<Trade, 'id' | 'timestamp' | 'confirmedAt'>): Promise<Trade> {
    const created = await this.prisma.trade.create({
      data: {
        walletAddress: trade.walletAddress,
        marketId: trade.marketId,
        outcome: trade.outcome,
        side: trade.side,
        price: trade.price,
        size: trade.size,
        txHash: trade.txHash,
        blockNumber: trade.blockNumber,
        gasUsed: trade.gasUsed,
        fee: trade.fee,
      },
    });

    return this.toModel(created);
  }

  async upsert(trade: Trade): Promise<Trade> {
    const saved = await this.prisma.trade.upsert({
      where: { id: trade.id },
      create: {
        id: trade.id,
        walletAddress: trade.walletAddress,
        marketId: trade.marketId,
        outcome: trade.outcome,
        side: trade.side,
        price: trade.price,
        size: trade.size,
        txHash: trade.txHash,
        blockNumber: trade.blockNumber,
        gasUsed: trade.gasUsed,
        fee: trade.fee,
        timestamp: trade.timestamp,
        confirmedAt: trade.confirmedAt,
      },
      update: {
        txHash: trade.txHash,
        blockNumber: trade.blockNumber,
        gasUsed: trade.gasUsed,
        fee: trade.fee,
        confirmedAt: trade.confirmedAt,
      },
    });

    return this.toModel(saved);
  }

  private toModel(prismaTrade: PrismaTrade): Trade {
    return {
      id: prismaTrade.id,
      walletAddress: prismaTrade.walletAddress,
      marketId: prismaTrade.marketId,
      outcome: prismaTrade.outcome as 'YES' | 'NO',
      side: prismaTrade.side as 'buy' | 'sell',
      price: prismaTrade.price.toString(),
      size: prismaTrade.size.toString(),
      txHash: prismaTrade.txHash,
      blockNumber: prismaTrade.blockNumber,
      gasUsed: prismaTrade.gasUsed,
      fee: prismaTrade.fee?.toString() || null,
      timestamp: prismaTrade.timestamp,
      confirmedAt: prismaTrade.confirmedAt,
    };
  }
}
