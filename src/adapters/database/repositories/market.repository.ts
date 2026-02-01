import { PrismaClient, Market as PrismaMarket } from '@prisma/client';
import { Market, MarketFilters } from '../../../types/market.types.js';
import { getPrismaClient } from '../client.js';

export class MarketRepository {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = getPrismaClient();
  }

  async findById(id: string): Promise<Market | null> {
    const market = await this.prisma.market.findUnique({
      where: { id },
    });

    return market ? this.toModel(market) : null;
  }

  async findMany(filters: MarketFilters): Promise<{ markets: Market[]; total: number }> {
    const where = {
      ...(filters.active !== undefined && { active: filters.active }),
      ...(filters.category && { categoryTag: filters.category }),
    };

    const [markets, total] = await Promise.all([
      this.prisma.market.findMany({
        where,
        take: filters.limit || 20,
        skip: filters.offset || 0,
        orderBy: { lastUpdated: 'desc' },
      }),
      this.prisma.market.count({ where }),
    ]);

    return {
      markets: markets.map((m) => this.toModel(m)),
      total,
    };
  }

  async create(market: Omit<Market, 'createdAt' | 'lastUpdated'>): Promise<Market> {
    const created = await this.prisma.market.create({
      data: {
        id: market.id,
        question: market.question,
        outcomes: market.outcomes,
        expiryDate: market.expiryDate,
        liquidity: market.liquidity,
        volume24h: market.volume24h,
        categoryTag: market.categoryTag,
        marketSlug: market.marketSlug,
        active: market.active,
        tokens: market.tokens,
      },
    });

    return this.toModel(created);
  }

  async update(
    id: string,
    data: Partial<Omit<Market, 'id' | 'createdAt' | 'lastUpdated'>>,
  ): Promise<Market> {
    const updated = await this.prisma.market.update({
      where: { id },
      data,
    });

    return this.toModel(updated);
  }

  async upsert(market: Omit<Market, 'createdAt' | 'lastUpdated'>): Promise<Market> {
    const upserted = await this.prisma.market.upsert({
      where: { id: market.id },
      create: {
        id: market.id,
        question: market.question,
        outcomes: market.outcomes,
        expiryDate: market.expiryDate,
        liquidity: market.liquidity,
        volume24h: market.volume24h,
        categoryTag: market.categoryTag,
        marketSlug: market.marketSlug,
        active: market.active,
        tokens: market.tokens,
      },
      update: {
        question: market.question,
        outcomes: market.outcomes,
        expiryDate: market.expiryDate,
        liquidity: market.liquidity,
        volume24h: market.volume24h,
        categoryTag: market.categoryTag,
        marketSlug: market.marketSlug,
        active: market.active,
        tokens: market.tokens,
      },
    });

    return this.toModel(upserted);
  }

  private toModel(prismaMarket: PrismaMarket): Market {
    return {
      id: prismaMarket.id,
      question: prismaMarket.question,
      outcomes: prismaMarket.outcomes as string[],
      expiryDate: prismaMarket.expiryDate,
      liquidity: prismaMarket.liquidity.toString(),
      volume24h: prismaMarket.volume24h.toString(),
      categoryTag: prismaMarket.categoryTag,
      marketSlug: prismaMarket.marketSlug,
      active: prismaMarket.active,
      tokens: prismaMarket.tokens as Record<string, string>,
      createdAt: prismaMarket.createdAt,
      lastUpdated: prismaMarket.lastUpdated,
    };
  }
}
