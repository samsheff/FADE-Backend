import { WatchlistRepository } from '../../adapters/database/repositories/watchlist.repository.js';
import type {
  WatchlistRecord,
  WatchlistWithMarkets,
  CreateWatchlistInput,
  UpdateWatchlistInput,
  ToggleMarketResult,
} from '../../types/watchlist.types.js';

/**
 * Watchlist Service
 * Business logic for watchlist-related operations
 */
export class WatchlistService {
  private watchlistRepo: WatchlistRepository;

  constructor() {
    this.watchlistRepo = new WatchlistRepository();
  }

  /**
   * Get all watchlists
   */
  async getAllWatchlists(): Promise<WatchlistRecord[]> {
    return this.watchlistRepo.findAll();
  }

  /**
   * Get a watchlist by ID
   */
  async getWatchlistById(id: string): Promise<WatchlistRecord | null> {
    return this.watchlistRepo.findById(id);
  }

  /**
   * Get a watchlist with all its markets
   */
  async getWatchlistWithMarkets(id: string): Promise<WatchlistWithMarkets | null> {
    return this.watchlistRepo.findByIdWithMarkets(id);
  }

  /**
   * Create a new watchlist
   * Validates that sortOrder is between 1-9
   */
  async createWatchlist(input: CreateWatchlistInput): Promise<WatchlistRecord> {
    // Validate sortOrder range
    if (input.sortOrder < 1 || input.sortOrder > 9) {
      throw new Error('sortOrder must be between 1 and 9');
    }

    // Check if sortOrder is already taken
    const existing = await this.watchlistRepo.findBySortOrder(input.sortOrder);
    if (existing) {
      throw new Error(`A watchlist with sortOrder ${input.sortOrder} already exists`);
    }

    return this.watchlistRepo.create(input);
  }

  /**
   * Update a watchlist
   * Validates sortOrder if provided
   */
  async updateWatchlist(id: string, input: UpdateWatchlistInput): Promise<WatchlistRecord | null> {
    // Validate sortOrder range if provided
    if (input.sortOrder !== undefined) {
      if (input.sortOrder < 1 || input.sortOrder > 9) {
        throw new Error('sortOrder must be between 1 and 9');
      }

      // Check if sortOrder is already taken by another watchlist
      const existing = await this.watchlistRepo.findBySortOrder(input.sortOrder);
      if (existing && existing.id !== id) {
        throw new Error(`A watchlist with sortOrder ${input.sortOrder} already exists`);
      }
    }

    return this.watchlistRepo.update(id, input);
  }

  /**
   * Delete a watchlist
   */
  async deleteWatchlist(id: string): Promise<boolean> {
    return this.watchlistRepo.delete(id);
  }

  /**
   * Toggle market membership in a watchlist
   * Returns true if market was added, false if removed
   */
  async toggleMarket(watchlistId: string, marketId: string): Promise<ToggleMarketResult> {
    const added = await this.watchlistRepo.toggleMarket(watchlistId, marketId);
    return { added };
  }

  /**
   * Get all watchlists that contain a specific market
   */
  async getWatchlistsForMarket(marketId: string): Promise<WatchlistRecord[]> {
    return this.watchlistRepo.findWatchlistsForMarket(marketId);
  }
}
