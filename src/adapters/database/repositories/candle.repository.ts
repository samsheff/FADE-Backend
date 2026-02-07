import { PrismaClient, Candle as PrismaCandle } from '@prisma/client';
import { getLogger } from '../../../utils/logger.js';
import { TradingViewCandle } from '../../../services/market-data/tradingview-data.service.js';

const prisma = new PrismaClient();

export interface CandleQuery {
  marketId?: string;
  instrumentId?: string;
  interval: string;
  outcome?: string;
  from: Date;
  to: Date;
}

export class CandleRepository {
  private get logger() {
    return getLogger();
  }
  /**
   * Upsert multiple candles (insert new, update existing based on unique constraint)
   */
  async upsertCandles(candles: TradingViewCandle[]): Promise<void> {
    if (candles.length === 0) {
      return;
    }

    // Deduplicate candles by unique constraint fields to avoid race conditions
    // when multiple requests fetch the same data concurrently
    const uniqueCandles = Array.from(
      candles.reduce((map, candle) => {
        const key = `${candle.instrumentId}_${candle.interval}_${candle.timestamp.getTime()}_${candle.source}`;
        // Keep the last occurrence (most recent data)
        map.set(key, candle);
        return map;
      }, new Map<string, TradingViewCandle>()).values()
    );

    this.logger.debug(
      { total: candles.length, unique: uniqueCandles.length },
      'Upserting candles (deduplicated)'
    );

    try {
      // Use transaction with sequential upserts
      // (Prisma has issues with nullable fields in compound unique constraints)
      await prisma.$transaction(async (tx) => {
        for (const candle of uniqueCandles) {
          // Check if candle exists
          const existing = await tx.candle.findFirst({
            where: {
              instrumentId: candle.instrumentId,
              interval: candle.interval,
              timestamp: candle.timestamp,
              source: candle.source,
              marketId: null,
              outcome: null,
            },
          });

          if (existing) {
            // Update existing candle
            await tx.candle.update({
              where: { id: existing.id },
              data: {
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                volume: candle.volume,
                endTime: candle.endTime,
              },
            });
          } else {
            // Create new candle
            await tx.candle.create({
              data: {
                instrumentId: candle.instrumentId,
                interval: candle.interval,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                volume: candle.volume,
                timestamp: candle.timestamp,
                endTime: candle.endTime,
                source: candle.source,
              },
            });
          }
        }
      });

      this.logger.debug({ count: candles.length }, 'Candles upserted successfully');
    } catch (error) {
      this.logger.error({ error, count: candles.length }, 'Failed to upsert candles');
      throw error;
    }
  }

  /**
   * Find candles by instrument
   */
  async findByInstrument(query: CandleQuery): Promise<PrismaCandle[]> {
    const { instrumentId, interval, from, to } = query;

    if (!instrumentId) {
      throw new Error('instrumentId is required for findByInstrument');
    }

    const candles = await prisma.candle.findMany({
      where: {
        instrumentId,
        interval,
        timestamp: {
          gte: from,
          lte: to,
        },
      },
      orderBy: {
        timestamp: 'asc',
      },
    });

    return candles;
  }

  /**
   * Find candles by market (for backward compatibility with existing market candles)
   */
  async findByMarket(query: CandleQuery): Promise<PrismaCandle[]> {
    const { marketId, interval, outcome, from, to } = query;

    if (!marketId) {
      throw new Error('marketId is required for findByMarket');
    }

    const candles = await prisma.candle.findMany({
      where: {
        marketId,
        interval,
        outcome,
        timestamp: {
          gte: from,
          lte: to,
        },
      },
      orderBy: {
        timestamp: 'asc',
      },
    });

    return candles;
  }

  /**
   * Get the latest candle timestamp for an instrument
   * Useful for watermark tracking (only fetch candles after this timestamp)
   */
  async getLatestTimestamp(instrumentId: string, interval: string): Promise<Date | null> {
    const latest = await prisma.candle.findFirst({
      where: {
        instrumentId,
        interval,
      },
      orderBy: {
        timestamp: 'desc',
      },
      select: {
        timestamp: true,
      },
    });

    return latest?.timestamp || null;
  }

  /**
   * Delete candles older than a given date (for cleanup/archival)
   */
  async deleteOlderThan(cutoffDate: Date): Promise<number> {
    const result = await prisma.candle.deleteMany({
      where: {
        timestamp: {
          lt: cutoffDate,
        },
      },
    });

    this.logger.info({ count: result.count, cutoffDate }, 'Deleted old candles');
    return result.count;
  }
}
