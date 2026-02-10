import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../client.js';
import type {
  WatchlistRecord,
  WatchlistItemRecord,
  WatchlistWithMarkets,
  CreateWatchlistInput,
  UpdateWatchlistInput,
} from '../../../types/watchlist.types.js';

export class WatchlistRepository {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = getPrismaClient();
  }

  /**
   * Find all watchlists, ordered by sortOrder
   */
  async findAll(): Promise<WatchlistRecord[]> {
    const watchlists = await this.prisma.watchlist.findMany({
      orderBy: { sortOrder: 'asc' },
    });

    return watchlists.map((w) => this.toModel(w));
  }

  /**
   * Find a watchlist by ID
   */
  async findById(id: string): Promise<WatchlistRecord | null> {
    const watchlist = await this.prisma.watchlist.findUnique({
      where: { id },
    });

    return watchlist ? this.toModel(watchlist) : null;
  }

  /**
   * Find a watchlist by sortOrder (1-9)
   */
  async findBySortOrder(sortOrder: number): Promise<WatchlistRecord | null> {
    const watchlist = await this.prisma.watchlist.findUnique({
      where: { sortOrder },
    });

    return watchlist ? this.toModel(watchlist) : null;
  }

  /**
   * Get a watchlist with all its markets (with full market details)
   */
  async findByIdWithMarkets(id: string): Promise<WatchlistWithMarkets | null> {
    const watchlist = await this.prisma.watchlist.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            market: {
              select: {
                id: true,
                question: true,
                categoryTag: true,
                yesPrice: true,
                noPrice: true,
                expiryDate: true,
                active: true,
              },
            },
          },
          orderBy: { addedAt: 'desc' },
        },
      },
    });

    if (!watchlist) return null;

    return {
      ...this.toModel(watchlist),
      items: watchlist.items.map((item) => ({
        id: item.id,
        marketId: item.marketId,
        addedAt: item.addedAt,
        market: {
          id: item.market.id,
          question: item.market.question,
          categoryTag: item.market.categoryTag,
          yesPrice: item.market.yesPrice?.toString() ?? null,
          noPrice: item.market.noPrice?.toString() ?? null,
          expiryDate: item.market.expiryDate,
          active: item.market.active,
        },
      })),
    };
  }

  /**
   * Create a new watchlist
   */
  async create(input: CreateWatchlistInput): Promise<WatchlistRecord> {
    const watchlist = await this.prisma.watchlist.create({
      data: {
        name: input.name,
        sortOrder: input.sortOrder,
      },
    });

    return this.toModel(watchlist);
  }

  /**
   * Update a watchlist
   */
  async update(id: string, input: UpdateWatchlistInput): Promise<WatchlistRecord | null> {
    try {
      const watchlist = await this.prisma.watchlist.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
        },
      });

      return this.toModel(watchlist);
    } catch (error) {
      return null;
    }
  }

  /**
   * Delete a watchlist (cascade deletes all items)
   */
  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.watchlist.delete({
        where: { id },
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Add a market to a watchlist
   */
  async addMarket(watchlistId: string, marketId: string): Promise<WatchlistItemRecord> {
    const item = await this.prisma.watchlistItem.create({
      data: {
        watchlistId,
        marketId,
      },
    });

    return this.toItemModel(item);
  }

  /**
   * Remove a market from a watchlist
   */
  async removeMarket(watchlistId: string, marketId: string): Promise<boolean> {
    try {
      await this.prisma.watchlistItem.delete({
        where: {
          watchlistId_marketId: {
            watchlistId,
            marketId,
          },
        },
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if a market is in a watchlist
   */
  async isMarketInWatchlist(watchlistId: string, marketId: string): Promise<boolean> {
    const item = await this.prisma.watchlistItem.findUnique({
      where: {
        watchlistId_marketId: {
          watchlistId,
          marketId,
        },
      },
    });

    return item !== null;
  }

  /**
   * Toggle market membership (add if not present, remove if present)
   * Returns true if added, false if removed
   */
  async toggleMarket(watchlistId: string, marketId: string): Promise<boolean> {
    const exists = await this.isMarketInWatchlist(watchlistId, marketId);

    if (exists) {
      await this.removeMarket(watchlistId, marketId);
      return false;
    } else {
      await this.addMarket(watchlistId, marketId);
      return true;
    }
  }

  /**
   * Get all watchlists that contain a specific market
   */
  async findWatchlistsForMarket(marketId: string): Promise<WatchlistRecord[]> {
    const watchlists = await this.prisma.watchlist.findMany({
      where: {
        items: {
          some: {
            marketId,
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });

    return watchlists.map((w) => this.toModel(w));
  }

  // Private helper methods

  private toModel(watchlist: {
    id: string;
    name: string;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  }): WatchlistRecord {
    return {
      id: watchlist.id,
      name: watchlist.name,
      sortOrder: watchlist.sortOrder,
      createdAt: watchlist.createdAt,
      updatedAt: watchlist.updatedAt,
    };
  }

  private toItemModel(item: {
    id: string;
    watchlistId: string;
    marketId: string;
    addedAt: Date;
  }): WatchlistItemRecord {
    return {
      id: item.id,
      watchlistId: item.watchlistId,
      marketId: item.marketId,
      addedAt: item.addedAt,
    };
  }
}
