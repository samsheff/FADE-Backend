/**
 * Phase 3: Signal Generation Framework - Price Tracker Service
 *
 * In-memory price snapshot tracking for detecting significant market movements.
 * Queries MarketRepository for current prices and calculates percentage changes.
 */

import { MarketRepository } from '../../../adapters/database/repositories/market.repository.js';
import { InstrumentRepository } from '../../../adapters/database/repositories/instrument.repository.js';
import type { PriceSnapshot } from '../types/generator.types.js';
import { logger } from '../../../utils/logger.js';

/**
 * Price change result
 */
interface PriceChange {
  instrumentId: string;
  previousPrice: number;
  currentPrice: number;
  changePct: number;
  timestamp: Date;
}

/**
 * Service for tracking instrument price snapshots and detecting movements
 */
export class PriceTrackerService {
  private readonly marketRepo: MarketRepository;
  private readonly instrumentRepo: InstrumentRepository;

  /**
   * In-memory price snapshot cache
   * Map: instrumentId => PriceSnapshot
   */
  private priceSnapshots: Map<string, PriceSnapshot> = new Map();

  /**
   * Threshold for significant price movement (percent)
   */
  private readonly significantChangeThreshold = 5.0;

  constructor(
    marketRepo: MarketRepository,
    instrumentRepo: InstrumentRepository
  ) {
    this.marketRepo = marketRepo;
    this.instrumentRepo = instrumentRepo;
  }

  /**
   * Get current market price for an instrument
   * Uses midpoint of yesPrice/noPrice from linked market
   *
   * @param instrumentId - Instrument to get price for
   * @returns Current price or null if no market data
   */
  async getCurrentPrice(instrumentId: string): Promise<number | null> {
    try {
      // Find market linked to this instrument
      const markets = await this.marketRepo.findByInstrument(instrumentId);

      if (markets.length === 0) {
        return null;
      }

      // Use first market (typically only one per instrument)
      const market = markets[0];

      // Calculate midpoint from yesPrice/noPrice (stored in cents)
      const yesPrice = market.yesPrice ?? 50;
      const noPrice = market.noPrice ?? 50;
      const midpoint = (yesPrice + noPrice) / 2;

      return midpoint;
    } catch (error) {
      logger.error('Error fetching current price', {
        instrumentId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Update price snapshot for a single instrument
   *
   * @param instrumentId - Instrument to update
   * @returns Price change info or null if no change/data
   */
  async updateInstrumentPrice(
    instrumentId: string
  ): Promise<PriceChange | null> {
    const currentPrice = await this.getCurrentPrice(instrumentId);

    if (currentPrice === null) {
      return null;
    }

    const previousSnapshot = this.priceSnapshots.get(instrumentId);
    const now = new Date();

    // Store new snapshot
    this.priceSnapshots.set(instrumentId, {
      value: currentPrice,
      timestamp: now,
    });

    // Calculate change if we have previous data
    if (!previousSnapshot) {
      return null;
    }

    const changePct =
      ((currentPrice - previousSnapshot.value) / previousSnapshot.value) * 100;

    return {
      instrumentId,
      previousPrice: previousSnapshot.value,
      currentPrice,
      changePct,
      timestamp: now,
    };
  }

  /**
   * Update prices for all active instruments and return significant changes
   *
   * @returns Map of instrumentId to PriceChange for movements > threshold
   */
  async updateAllPrices(): Promise<Map<string, PriceChange>> {
    const significantChanges = new Map<string, PriceChange>();

    try {
      // Get all active instruments
      const instruments = await this.instrumentRepo.findAll();

      logger.info('Updating prices for all instruments', {
        count: instruments.length,
      });

      // Update each instrument
      for (const instrument of instruments) {
        const change = await this.updateInstrumentPrice(instrument.id);

        if (
          change &&
          Math.abs(change.changePct) >= this.significantChangeThreshold
        ) {
          significantChanges.set(instrument.id, change);
        }
      }

      logger.info('Price update complete', {
        totalInstruments: instruments.length,
        significantChanges: significantChanges.size,
      });
    } catch (error) {
      logger.error('Error updating all prices', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    return significantChanges;
  }

  /**
   * Remove stale snapshots older than 24 hours
   */
  clearStaleSnapshots(): void {
    const now = Date.now();
    const staleThresholdMs = 24 * 60 * 60 * 1000; // 24 hours

    let removedCount = 0;

    for (const [instrumentId, snapshot] of this.priceSnapshots.entries()) {
      if (now - snapshot.timestamp.getTime() > staleThresholdMs) {
        this.priceSnapshots.delete(instrumentId);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      logger.info('Cleared stale price snapshots', { count: removedCount });
    }
  }

  /**
   * Get current snapshot count (for monitoring)
   */
  getSnapshotCount(): number {
    return this.priceSnapshots.size;
  }

  /**
   * Clear all snapshots (for testing)
   */
  clearAllSnapshots(): void {
    this.priceSnapshots.clear();
  }
}
