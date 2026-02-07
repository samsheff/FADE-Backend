/**
 * TradingViewDataService - Fetches historical candles from TradingView
 *
 * Uses @mathieuc/tradingview for data fetching
 * Installation: npm install @mathieuc/tradingview
 */

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

export interface TradingViewCandle {
  instrumentId: string;
  interval: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  timestamp: Date;
  endTime: Date;
  source: 'tradingview';
}

export class TradingViewDataService {
  private client: any = null;
  private get logger() {
    return getLogger();
  }

  constructor() {
    if (TradingView) {
      this.client = new TradingView.Client();
    }
  }

  /**
   * Fetch historical candles from TradingView
   *
   * @param instrumentId - Internal instrument ID
   * @param symbol - Ticker symbol (e.g., 'AAPL', 'NASDAQ:AAPL')
   * @param interval - Internal interval format ('1m', '5m', '1h', '1d')
   * @param from - Start date
   * @param to - End date
   * @returns Array of normalized candles
   */
  async fetchHistoricalCandles(
    instrumentId: string,
    symbol: string,
    interval: string,
    from: Date,
    to: Date,
  ): Promise<TradingViewCandle[]> {
    if (!this.client) {
      this.logger.warn(
        { symbol, interval },
        'TradingView package not installed - install with: npm install @mathieuc/tradingview',
      );
      return [];
    }

    return new Promise((resolve) => {
      try {
        const tvInterval = this.mapIntervalToTradingView(interval);

        this.logger.debug(
          { symbol, interval: tvInterval },
          'Fetching TradingView historical data',
        );

        // Create a chart session
        const chart = new this.client.Session.Chart();

        let periods: any[] = [];
        let hasLoaded = false;

        // Set up error handler
        chart.onError((...err: any[]) => {
          this.logger.error({ err, symbol }, 'TradingView chart error');
          chart.delete();
          resolve([]);
        });

        // When symbol loads successfully
        chart.onSymbolLoaded(() => {
          hasLoaded = true;
          this.logger.debug({ symbol }, 'TradingView symbol loaded');
        });

        // Collect periods as they update
        chart.onUpdate(() => {
          if (chart.periods && chart.periods.length > 0) {
            periods = chart.periods;
          }
        });

        // Set the market
        chart.setMarket(symbol, {
          timeframe: tvInterval,
        });

        // Wait for data to load, then process
        setTimeout(() => {
          chart.delete();

          if (periods.length === 0) {
            this.logger.warn({ symbol, interval }, 'No historical data returned from TradingView');
            resolve([]);
            return;
          }

          const intervalMs = this.intervalToMs(interval);
          const candles = periods
            .filter((bar: any) => bar && bar.time)
            .map((bar: any) => {
              // TradingView periods might not have high/low, calculate from open/close
              const open = Number(bar.open) || 0;
              const close = Number(bar.close) || 0;
              const high = Number(bar.high) || Math.max(open, close);
              const low = Number(bar.low) || Math.min(open, close);

              return {
                instrumentId,
                interval,
                open: open.toString(),
                high: high.toString(),
                low: low.toString(),
                close: close.toString(),
                volume: bar.volume?.toString() || '0',
                timestamp: new Date(bar.time * 1000),
                endTime: new Date(bar.time * 1000 + intervalMs),
                source: 'tradingview' as const,
              };
            });

          this.logger.info(
            { symbol, interval, count: candles.length },
            'Successfully fetched TradingView candles',
          );

          resolve(candles);
        }, 3000); // Wait 3 seconds for data to accumulate
      } catch (error) {
        this.logger.error({ error, symbol, interval }, 'Failed to fetch TradingView data');
        resolve([]);
      }
    });
  }

  /**
   * Map internal interval format to TradingView format
   * '1h' -> '60', '1d' -> 'D', etc.
   */
  private mapIntervalToTradingView(interval: string): string {
    const mapping: Record<string, string> = {
      '1m': '1',
      '5m': '5',
      '15m': '15',
      '1h': '60',
      '1d': 'D',
    };
    return mapping[interval] || interval;
  }

  private intervalToMs(interval: string): number {
    const mapping: Record<string, number> = {
      '1m': 60_000,
      '5m': 300_000,
      '15m': 900_000,
      '1h': 3_600_000,
      '1d': 86_400_000,
    };
    return mapping[interval] || 60_000;
  }
}
