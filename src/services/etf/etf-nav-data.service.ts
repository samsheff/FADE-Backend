import { PrismaClient } from '@prisma/client';
import { EtfMetricsRepository } from '../../adapters/database/repositories/etf-metrics.repository.js';
import { EtfMetricsRecord, PremiumDiscountStats } from '../../types/etf.types.js';
import { getPrismaClient } from '../../adapters/database/client.js';

/**
 * Service for accessing ETF NAV and premium/discount time series data
 */
export class EtfNavDataService {
  private etfMetricsRepo: EtfMetricsRepository;

  constructor(prisma?: PrismaClient) {
    const client = prisma || getPrismaClient();
    this.etfMetricsRepo = new EtfMetricsRepository(client);
  }

  /**
   * Get NAV time series for an instrument
   */
  async getNavTimeSeries(
    instrumentId: string,
    from: Date,
    to: Date
  ): Promise<EtfMetricsRecord[]> {
    return this.etfMetricsRepo.findByDateRange(instrumentId, from, to);
  }

  /**
   * Get premium/discount statistics over a period
   */
  async getPremiumDiscountStats(
    instrumentId: string,
    days: number
  ): Promise<PremiumDiscountStats | null> {
    const stats = await this.etfMetricsRepo.getPremiumDiscountStats(instrumentId, days);
    if (!stats) return null;

    const { mean, stdDev, current } = stats;
    const zScore = stdDev > 0 ? (current - mean) / stdDev : 0;

    // Calculate min/max from historical data
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const metrics = await this.etfMetricsRepo.findByDateRange(
      instrumentId,
      cutoffDate,
      new Date()
    );

    const values = metrics
      .filter((m) => m.premium !== null)
      .map((m) => Number(m.premium));

    return {
      mean,
      stdDev,
      current,
      zScore,
      min: values.length > 0 ? Math.min(...values) : 0,
      max: values.length > 0 ? Math.max(...values) : 0,
      sampleSize: values.length,
    };
  }

  /**
   * Get number of consecutive days with premium/discount above threshold
   */
  async getConsecutivePremiumDays(
    instrumentId: string,
    threshold: number,
    direction: 'PREMIUM' | 'DISCOUNT'
  ): Promise<number> {
    return this.etfMetricsRepo.getConsecutiveDays(instrumentId, threshold, direction);
  }

  /**
   * Get latest NAV data for an instrument
   */
  async getLatestNav(instrumentId: string): Promise<EtfMetricsRecord | null> {
    return this.etfMetricsRepo.findLatestByInstrument(instrumentId);
  }

  /**
   * Check if premium/discount is extreme (>2 std deviations from mean)
   */
  async isExtremeDeviation(
    instrumentId: string,
    lookbackDays: number = 60
  ): Promise<{ isExtreme: boolean; zScore: number; stats: PremiumDiscountStats } | null> {
    const stats = await this.getPremiumDiscountStats(instrumentId, lookbackDays);
    if (!stats) return null;

    const isExtreme = Math.abs(stats.zScore) > 2.0;

    return {
      isExtreme,
      zScore: stats.zScore,
      stats,
    };
  }
}
