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
