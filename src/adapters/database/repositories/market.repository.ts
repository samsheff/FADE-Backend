import { Prisma, PrismaClient, Market as PrismaMarket } from '@prisma/client';
import { MarketFilters, MarketRecord } from '../../../types/market.types.js';
import { getPrismaClient } from '../client.js';

export class MarketRepository {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = getPrismaClient();
  }

  async findById(id: string): Promise<MarketRecord | null> {
    const market = await this.prisma.market.findUnique({
      where: { id },
    });

    return market ? this.toModel(market) : null;
  }

  async findMany(filters: MarketFilters): Promise<{ markets: MarketRecord[]; total: number }> {
    const where: Prisma.MarketWhereInput = {
      ...(filters.active !== undefined && { active: filters.active }),
      ...(filters.category && { categoryTag: filters.category }),
      ...(filters.expiresAfter && { expiryDate: { gt: filters.expiresAfter } }),
      // Exclude resolved/closed markets
      NOT: [
        // Exclude markets that completed early with zero prices
        {
          AND: [
            { completedEarly: true },
            { yesPrice: 0 },
            { noPrice: 0 },
          ],
        },
        // Exclude markets with extreme prices (0 or 100 cents = resolved)
        { yesPrice: 0 },
        { yesPrice: 100 },
        { noPrice: 0 },
        { noPrice: 100 },
      ],
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

  async searchMarkets(filters: {
    query: string;
    limit?: number;
    offset?: number;
    active?: boolean;
    expiresAfter?: Date;
  }): Promise<{ markets: MarketRecord[]; total: number }> {
    const trimmedQuery = filters.query.trim();
    const searchConditions: Prisma.MarketWhereInput[] = trimmedQuery
      ? [
          { question: { contains: trimmedQuery, mode: 'insensitive' } },
          { marketSlug: { contains: trimmedQuery, mode: 'insensitive' } },
          { categoryTag: { contains: trimmedQuery, mode: 'insensitive' } },
        ]
      : [];

    const where: Prisma.MarketWhereInput = {
      ...(filters.active !== undefined && { active: filters.active }),
      ...(filters.expiresAfter && { expiryDate: { gt: filters.expiresAfter } }),
      ...(searchConditions.length > 0 && { OR: searchConditions }),
      // Exclude markets that completed early with zero prices
      NOT: {
        AND: [
          { completedEarly: true },
          { yesPrice: 0 },
          { noPrice: 0 },
        ],
      },
    };

    const [markets, total] = await Promise.all([
      this.prisma.market.findMany({
        where,
        take: filters.limit ?? 50,
        skip: filters.offset ?? 0,
        orderBy: [
          { liquidity: 'desc' },
          { volume24h: 'desc' },
          { question: 'asc' },
        ],
      }),
      this.prisma.market.count({ where }),
    ]);

    return {
      markets: markets.map((m) => this.toModel(m)),
      total,
    };
  }

  async findAll(): Promise<MarketRecord[]> {
    const markets = await this.prisma.market.findMany({
      orderBy: { lastUpdated: 'desc' },
    });
    return markets.map((m) => this.toModel(m));
  }

  async create(market: Omit<MarketRecord, 'createdAt' | 'lastUpdated'>): Promise<MarketRecord> {
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
        polymarketMarketId: market.polymarketMarketId,
        yesPrice: market.yesPrice,
        noPrice: market.noPrice,
        volume: market.volume,
        lastIndexedBlock: market.lastIndexedBlock ? BigInt(market.lastIndexedBlock) : null,
        completedEarly: market.completedEarly,
      },
    });

    return this.toModel(created);
  }

  async update(
    id: string,
    data: Partial<Omit<MarketRecord, 'id' | 'createdAt' | 'lastUpdated'>>,
  ): Promise<MarketRecord> {
    const updated = await this.prisma.market.update({
      where: { id },
      data: {
        ...data,
        lastIndexedBlock: data.lastIndexedBlock ? BigInt(data.lastIndexedBlock) : undefined,
      },
    });

    return this.toModel(updated);
  }

  async upsert(market: Omit<MarketRecord, 'createdAt' | 'lastUpdated'>): Promise<MarketRecord> {
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
        polymarketMarketId: market.polymarketMarketId,
        yesPrice: market.yesPrice,
        noPrice: market.noPrice,
        volume: market.volume,
        lastIndexedBlock: market.lastIndexedBlock ? BigInt(market.lastIndexedBlock) : null,
        completedEarly: market.completedEarly,
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
        polymarketMarketId: market.polymarketMarketId,
        yesPrice: market.yesPrice,
        noPrice: market.noPrice,
        volume: market.volume,
        lastIndexedBlock: market.lastIndexedBlock ? BigInt(market.lastIndexedBlock) : null,
        completedEarly: market.completedEarly,
      },
    });

    return this.toModel(upserted);
  }

  private toModel(prismaMarket: PrismaMarket): MarketRecord {
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
      polymarketMarketId: prismaMarket.polymarketMarketId,
      yesPrice: prismaMarket.yesPrice ? prismaMarket.yesPrice.toString() : null,
      noPrice: prismaMarket.noPrice ? prismaMarket.noPrice.toString() : null,
      volume: prismaMarket.volume ? prismaMarket.volume.toString() : null,
      lastIndexedBlock: prismaMarket.lastIndexedBlock
        ? prismaMarket.lastIndexedBlock.toString()
        : null,
      completedEarly: prismaMarket.completedEarly,
      createdAt: prismaMarket.createdAt,
      lastUpdated: prismaMarket.lastUpdated,
      imageUrl: null, // TODO: Fetch from Polymarket when available
    };
  }
}
