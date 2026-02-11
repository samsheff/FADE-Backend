import { PrismaClient } from '@prisma/client';
import { getLogger } from '../../utils/logger.js';
import { UnifiedCandleService } from '../market-data/unified-candle.service.js';

export interface InstrumentPricingSummary {
  instrumentId: string;
  currentPrice: number;
  previousClose: number;
  dailyChange: number;
  dailyChangePercent: number;
  dailyVolume: number;
  lastUpdated: Date;
}

export class InstrumentPricingSummaryService {
  private logger;
  private candleService: UnifiedCandleService;

  constructor(_prisma: PrismaClient) {
    this.logger = getLogger();
    this.candleService = new UnifiedCandleService();
  }

  async getPricingSummary(instrumentId: string): Promise<InstrumentPricingSummary | null> {
    try {
      const now = new Date();

      // Determine session boundaries
      const previousSessionClose = this.getPreviousSessionClose(now);
      const sessionStart = this.getSessionStart(now);

      // Fetch 1-minute candles for the current session (from session start to now)
      // This will use UnifiedCandleService which fetches from TradingView if needed
      const sessionCandles = await this.candleService.getCandles({
        instrumentId,
        interval: '1m',
        from: sessionStart,
        to: now,
        limit: 500, // Max intraday 1m candles (6.5 hours * 60 minutes)
      });

      if (sessionCandles.length === 0) {
        this.logger.debug({ instrumentId }, 'No candles found for current session');
        return null;
      }

      // Get latest candle for current price
      const latestCandle = sessionCandles[sessionCandles.length - 1];
      const currentPrice = Number(latestCandle.close);

      // Fetch candle at or before previous session close
      const closeCandles = await this.candleService.getCandles({
        instrumentId,
        interval: '1m',
        from: new Date(previousSessionClose.getTime() - 3600000), // 1 hour before close
        to: previousSessionClose,
        limit: 100,
      });

      if (closeCandles.length === 0) {
        this.logger.debug(
          { instrumentId, previousSessionClose },
          'No candle found for previous session close',
        );
        return null;
      }

      const previousCloseCandle = closeCandles[closeCandles.length - 1];
      const previousClose = Number(previousCloseCandle.close);

      // Sum volume from session candles
      const dailyVolume = sessionCandles.reduce((sum, candle) => sum + Number(candle.volume), 0);

      // Compute change metrics
      const dailyChange = currentPrice - previousClose;
      const dailyChangePercent = previousClose > 0 ? (dailyChange / previousClose) * 100 : 0;

      return {
        instrumentId,
        currentPrice,
        previousClose,
        dailyChange,
        dailyChangePercent,
        dailyVolume,
        lastUpdated: new Date(latestCandle.timestamp),
      };
    } catch (error) {
      this.logger.error({ error, instrumentId }, 'Failed to compute pricing summary');
      return null;
    }
  }

  /**
   * Get previous session close time based on current time
   * Market hours: 9:30 AM - 4:00 PM ET
   */
  private getPreviousSessionClose(now: Date): Date {
    const marketOpenHour = 9;
    const marketOpenMinute = 30;
    const marketCloseHour = 16;

    // Create today's market open time (9:30 AM ET)
    const todayOpen = new Date(now);
    todayOpen.setHours(marketOpenHour, marketOpenMinute, 0, 0);

    // If current time is before market open, previous session = yesterday's close (4:00 PM)
    if (now < todayOpen) {
      const yesterdayClose = new Date(now);
      yesterdayClose.setDate(yesterdayClose.getDate() - 1);
      yesterdayClose.setHours(marketCloseHour, 0, 0, 0);

      // Handle weekends: if yesterday was Sunday, go back to Friday
      if (yesterdayClose.getDay() === 0) {
        // Sunday
        yesterdayClose.setDate(yesterdayClose.getDate() - 2);
      } else if (yesterdayClose.getDay() === 6) {
        // Saturday (shouldn't happen, but handle it)
        yesterdayClose.setDate(yesterdayClose.getDate() - 1);
      }

      return yesterdayClose;
    }

    // If current time is after market open, previous session = today's open (9:30 AM)
    return todayOpen;
  }

  /**
   * Get session start time for volume calculation
   * Same logic as getPreviousSessionClose but returns the timestamp
   */
  private getSessionStart(now: Date): Date {
    return this.getPreviousSessionClose(now);
  }
}
