/**
 * Type definitions for Watchlist functionality
 */

export interface WatchlistRecord {
  id: string;
  name: string;
  sortOrder: number; // 1-9 for keyboard shortcuts
  createdAt: Date;
  updatedAt: Date;
}

export interface WatchlistItemRecord {
  id: string;
  watchlistId: string;
  marketId: string;
  addedAt: Date;
}

export interface WatchlistWithMarkets extends WatchlistRecord {
  items: Array<{
    id: string;
    marketId: string;
    addedAt: Date;
    market: {
      id: string;
      question: string;
      categoryTag: string | null;
      yesPrice: string | null;
      noPrice: string | null;
      expiryDate: Date;
      active: boolean;
    };
  }>;
}

export interface CreateWatchlistInput {
  name: string;
  sortOrder: number; // Must be 1-9
}

export interface UpdateWatchlistInput {
  name?: string;
  sortOrder?: number; // Must be 1-9
}

export interface ToggleMarketResult {
  added: boolean; // true if market was added, false if removed
}
