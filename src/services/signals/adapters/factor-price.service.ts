/**
 * Phase 3: Signal Generation Framework - Factor Price Service
 *
 * Mock factor price tracking for Phase 3. Returns hardcoded prices and
 * simulates market movements for testing. Will be replaced with real API
 * integration in Phase 4.
 */

import { FactorType } from '../../../types/document.types.js';
import type { FactorPrice, PriceSnapshot } from '../types/generator.types.js';
import { logger } from '../../../utils/logger.js';

/**
 * Factor price change result
 */
interface FactorPriceChange {
  factorType: FactorType;
  previousPrice: number;
  currentPrice: number;
  changePct: number;
  timestamp: Date;
}

/**
 * Mock service for factor price tracking
 * TODO: Replace with real API integration in Phase 4
 */
export class FactorPriceService {
  /**
   * Mock baseline prices for factors
   */
  private readonly mockBasePrices: Record<FactorType, number> = {
    COMMODITY_GOLD: 2050.0,
    COMMODITY_SILVER: 24.5,
    COMMODITY_OIL: 78.0,
    COMMODITY_NATURAL_GAS: 2.8,
    COMMODITY_COPPER: 3.85,
    INDEX_SPX: 5200.0,
    INDEX_NASDAQ: 16500.0,
    INDEX_DOW: 38500.0,
    INDEX_RUSSELL_2000: 2100.0,
    INDEX_VIX: 15.0,
    RATE_10Y_TREASURY: 4.2,
    RATE_FED_FUNDS: 5.25,
    RATE_LIBOR: 5.4,
    CURRENCY_USD_INDEX: 103.5,
    CURRENCY_EUR_USD: 1.08,
    CURRENCY_GBP_USD: 1.26,
    CURRENCY_JPY_USD: 0.0067,
  };

  /**
   * In-memory price snapshot cache
   * Map: FactorType => PriceSnapshot
   */
  private priceSnapshots: Map<FactorType, PriceSnapshot> = new Map();

  /**
   * Initialize with baseline prices
   */
  constructor() {
    // Seed initial snapshots
    const now = new Date();
    for (const [factorType, price] of Object.entries(this.mockBasePrices)) {
      this.priceSnapshots.set(factorType as FactorType, {
        value: price,
        timestamp: now,
      });
    }
  }

  /**
   * Get current price for a factor
   *
   * @param factorType - Factor to get price for
   * @returns Current price or null if unknown factor
   */
  getCurrentPrice(factorType: FactorType): number | null {
    const snapshot = this.priceSnapshots.get(factorType);
    return snapshot ? snapshot.value : null;
  }

  /**
   * Update factor price and return percentage change
   *
   * @param factorType - Factor to update
   * @param newPrice - New price value
   * @returns Price change info or null if no previous data
   */
  updateFactorPrice(
    factorType: FactorType,
    newPrice: number
  ): FactorPriceChange | null {
    const previousSnapshot = this.priceSnapshots.get(factorType);
    const now = new Date();

    // Store new snapshot
    this.priceSnapshots.set(factorType, {
      value: newPrice,
      timestamp: now,
    });

    if (!previousSnapshot) {
      return null;
    }

    const changePct =
      ((newPrice - previousSnapshot.value) / previousSnapshot.value) * 100;

    return {
      factorType,
      previousPrice: previousSnapshot.value,
      currentPrice: newPrice,
      changePct,
      timestamp: now,
    };
  }

  /**
   * Simulate random market movements for testing
   * Generates 5-10% moves for a random subset of factors
   *
   * @returns Map of FactorType to FactorPriceChange for moved factors
   */
  simulateMarketMovement(): Map<FactorType, FactorPriceChange> {
    const movements = new Map<FactorType, FactorPriceChange>();

    // Get all factor types
    const allFactors = Object.keys(this.mockBasePrices) as FactorType[];

    // Select 2-4 random factors to move
    const numFactorsToMove = 2 + Math.floor(Math.random() * 3);
    const shuffled = [...allFactors].sort(() => Math.random() - 0.5);
    const factorsToMove = shuffled.slice(0, numFactorsToMove);

    logger.info('Simulating factor market movements', {
      factorsToMove,
    });

    for (const factorType of factorsToMove) {
      const currentPrice = this.getCurrentPrice(factorType);
      if (currentPrice === null) continue;

      // Generate random movement between -10% and +10%
      const changeDirection = Math.random() > 0.5 ? 1 : -1;
      const changeMagnitude = 5 + Math.random() * 5; // 5-10%
      const changePct = changeDirection * changeMagnitude;

      const newPrice = currentPrice * (1 + changePct / 100);

      const change = this.updateFactorPrice(factorType, newPrice);
      if (change) {
        movements.set(factorType, change);
      }
    }

    logger.info('Factor simulation complete', {
      movements: movements.size,
    });

    return movements;
  }

  /**
   * Get all current factor prices
   *
   * @returns Array of FactorPrice objects
   */
  getAllPrices(): FactorPrice[] {
    const prices: FactorPrice[] = [];

    for (const [factorType, snapshot] of this.priceSnapshots.entries()) {
      prices.push({
        factorType,
        price: snapshot.value,
        timestamp: snapshot.timestamp,
      });
    }

    return prices;
  }

  /**
   * Reset all prices to baseline (for testing)
   */
  resetToBaseline(): void {
    const now = new Date();
    for (const [factorType, price] of Object.entries(this.mockBasePrices)) {
      this.priceSnapshots.set(factorType as FactorType, {
        value: price,
        timestamp: now,
      });
    }

    logger.info('Reset factor prices to baseline');
  }
}
