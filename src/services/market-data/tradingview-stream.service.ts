/**
 * TradingViewStreamService - Real-time price streaming from TradingView
 *
 * Uses @mathieuc/tradingview for real-time quote streaming
 * Installation: npm install @mathieuc/tradingview
 */

import { EventEmitter } from 'events';
import { getLogger } from '../../utils/logger.js';
import { createRequire } from 'module';

// Use require for CommonJS package
const require = createRequire(import.meta.url);
let TradingView: any = null;
try {
  TradingView = require('@mathieuc/tradingview');
} catch (error) {
  // Package not installed - will log warnings when methods are called
}

export interface TradingViewPriceUpdate {
  instrumentId: string;
  symbol: string;
  price: string;
  bidPrice?: string;
  askPrice?: string;
  timestamp: Date;
}

type PriceUpdateCallback = (update: TradingViewPriceUpdate) => void;

export class TradingViewStreamService extends EventEmitter {
  private client: any = null;
  private subscriptions: Map<string, Set<string>> = new Map(); // instrumentId -> Set<symbol>
  private activeCharts: Map<string, any> = new Map(); // symbol -> chart instance
  private get logger() {
    return getLogger();
  }

  constructor() {
    super();
    if (TradingView) {
      this.client = new TradingView.Client();
    }
  }

  /**
   * Subscribe to real-time price updates for a symbol
   *
   * @param instrumentId - Internal instrument ID
   * @param symbol - Bare ticker symbol (e.g., 'AAPL')
   * @param callback - Called on each price update
   * @param tvSymbol - Optional resolved TradingView symbol (e.g., 'NASDAQ:AAPL')
   * @returns Unsubscribe function
   */
  subscribeToSymbol(
    instrumentId: string,
    symbol: string,
    callback: PriceUpdateCallback,
    tvSymbol?: string | null,
  ): () => void {
    // Use resolved TradingView symbol if available
    const marketSymbol = tvSymbol || symbol;

    this.logger.info(
      { instrumentId, bareSymbol: symbol, marketSymbol, tvSymbol },
      'Subscribing to TradingView stream',
    );

    // Track subscription to avoid duplicates
    if (!this.subscriptions.has(instrumentId)) {
      this.subscriptions.set(instrumentId, new Set());
    }
    this.subscriptions.get(instrumentId)!.add(marketSymbol);

    // Register callback
    this.on(`price:${instrumentId}`, callback);

    // Start streaming if not already active for this symbol
    if (!this.activeCharts.has(marketSymbol)) {
      this.startStreaming(instrumentId, marketSymbol).catch((err) => {
        this.logger.error({ err, instrumentId, marketSymbol }, 'Failed to start TradingView stream');
      });
    }

    // Return unsubscribe function
    return () => {
      this.off(`price:${instrumentId}`, callback);
      const symbols = this.subscriptions.get(instrumentId);
      if (symbols) {
        symbols.delete(marketSymbol);
        if (symbols.size === 0) {
          this.subscriptions.delete(instrumentId);
          this.stopStreaming(marketSymbol);
          this.logger.info({ instrumentId }, 'Unsubscribed from all symbols for instrument');
        }
      }
    };
  }

  private async startStreaming(instrumentId: string, symbol: string): Promise<void> {
    if (!this.client) {
      this.logger.warn(
        { symbol },
        'TradingView package not installed - install with: npm install @mathieuc/tradingview',
      );
      return;
    }

    try {
      // Create a chart session
      const chart = new this.client.Session.Chart();
      this.activeCharts.set(symbol, chart);

      // Set up error handler
      chart.onError((...err: any[]) => {
        this.logger.error({ err, symbol }, 'TradingView chart error');
      });

      // When symbol loads
      chart.onSymbolLoaded(() => {
        this.logger.info({ instrumentId, symbol }, 'TradingView symbol loaded for streaming');
      });

      // Subscribe to price updates
      chart.onUpdate(() => {
        if (!chart.periods || chart.periods.length === 0) return;

        const latest = chart.periods[0]; // Most recent period
        if (!latest) return;

        const update: TradingViewPriceUpdate = {
          instrumentId,
          symbol,
          price: latest.close?.toString() || '0',
          bidPrice: undefined, // TradingView doesn't provide separate bid/ask in this API
          askPrice: undefined,
          timestamp: new Date(),
        };

        this.emit(`price:${instrumentId}`, update);
      });

      // Set the market - use 1 minute for real-time updates
      chart.setMarket(symbol, {
        timeframe: '1',
      });

      this.logger.info({ instrumentId, symbol }, 'Started TradingView real-time stream');
    } catch (error) {
      this.logger.error({ error, instrumentId, symbol }, 'Failed to start TradingView stream');
    }
  }

  private stopStreaming(symbol: string): void {
    const chart = this.activeCharts.get(symbol);
    if (chart) {
      try {
        // Delete the chart session
        chart.delete();
        this.activeCharts.delete(symbol);
        this.logger.info({ symbol }, 'Stopped TradingView stream');
      } catch (error) {
        this.logger.error({ error, symbol }, 'Error stopping TradingView stream');
      }
    }
  }

  /**
   * Clean up all active streams
   */
  cleanup(): void {
    for (const [symbol, chart] of this.activeCharts.entries()) {
      try {
        chart.delete();
      } catch (error) {
        this.logger.error({ error, symbol }, 'Error cleaning up chart');
      }
    }
    this.activeCharts.clear();

    if (this.client) {
      try {
        this.client.end();
      } catch (error) {
        this.logger.error({ error }, 'Error closing TradingView client');
      }
    }
  }

  /**
   * Emit a price update (for testing or manual publishing)
   */
  emitPriceUpdate(update: TradingViewPriceUpdate): void {
    this.emit(`price:${update.instrumentId}`, update);
  }

  /**
   * Check if an instrument has active subscriptions
   */
  hasSubscription(instrumentId: string): boolean {
    const symbols = this.subscriptions.get(instrumentId);
    return symbols !== undefined && symbols.size > 0;
  }

  /**
   * Get all active subscriptions
   */
  getActiveSubscriptions(): Map<string, Set<string>> {
    return new Map(this.subscriptions);
  }
}
