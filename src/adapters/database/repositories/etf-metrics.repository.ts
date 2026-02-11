import { PrismaClient, EtfMetrics } from '@prisma/client';
import { CreateEtfMetricsInput, EtfMetricsRecord } from '../../../types/etf.types.js';

/**
 * Repository for ETF metrics time-series data
 */
export class EtfMetricsRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Find latest metrics for an instrument
   */
  async findLatestByInstrument(instrumentId: string): Promise<EtfMetricsRecord | null> {
    const metrics = await this.prisma.etfMetrics.findFirst({
      where: { instrumentId },
      orderBy: { asOfDate: 'desc' },
    });

    return metrics as EtfMetricsRecord | null;
  }

  /**
   * Find historical metrics for an instrument (most recent first)
   */
  async findHistoricalByInstrument(
    instrumentId: string,
    limit: number = 100
  ): Promise<EtfMetricsRecord[]> {
    const metrics = await this.prisma.etfMetrics.findMany({
      where: { instrumentId },
      orderBy: { asOfDate: 'desc' },
      take: limit,
    });

    return metrics as EtfMetricsRecord[];
  }

  /**
   * Find metrics within a date range
   */
  async findByDateRange(
    instrumentId: string,
    from: Date,
    to: Date
  ): Promise<EtfMetricsRecord[]> {
    const metrics = await this.prisma.etfMetrics.findMany({
      where: {
        instrumentId,
        asOfDate: {
          gte: from,
          lte: to,
        },
      },
      orderBy: { asOfDate: 'asc' },
    });

    return metrics as EtfMetricsRecord[];
  }

  /**
   * Upsert metrics (insert or update based on unique constraint)
   */
  async upsertMetrics(input: CreateEtfMetricsInput): Promise<EtfMetricsRecord> {
    const metrics = await this.prisma.etfMetrics.upsert({
      where: {
        instrumentId_asOfDate_sourceType: {
          instrumentId: input.instrumentId,
          asOfDate: input.asOfDate,
          sourceType: input.sourceType,
        },
      },
      create: {
        instrumentId: input.instrumentId,
        nav: input.nav ?? null,
        marketPrice: input.marketPrice ?? null,
        premium: input.premium ?? null,
        activeApCount: input.activeApCount ?? null,
        topThreeApShare: input.topThreeApShare ?? null,
        hhi: input.hhi ?? null,
        creationUnits: input.creationUnits ?? null,
        redemptionUnits: input.redemptionUnits ?? null,
        netFlowUnits: input.netFlowUnits ?? null,
        asOfDate: input.asOfDate,
        sourceType: input.sourceType,
        filingId: input.filingId ?? null,
      },
      update: {
        nav: input.nav ?? null,
        marketPrice: input.marketPrice ?? null,
        premium: input.premium ?? null,
        activeApCount: input.activeApCount ?? null,
        topThreeApShare: input.topThreeApShare ?? null,
        hhi: input.hhi ?? null,
        creationUnits: input.creationUnits ?? null,
        redemptionUnits: input.redemptionUnits ?? null,
        netFlowUnits: input.netFlowUnits ?? null,
        filingId: input.filingId ?? null,
      },
    });

    return metrics as EtfMetricsRecord;
  }

  /**
   * Get consecutive days with premium/discount above threshold
   */
  async getConsecutiveDays(
    instrumentId: string,
    threshold: number,
    direction: 'PREMIUM' | 'DISCOUNT'
  ): Promise<number> {
    const metrics = await this.prisma.etfMetrics.findMany({
      where: {
        instrumentId,
        premium: { not: null },
      },
      orderBy: { asOfDate: 'desc' },
      take: 30, // Look back 30 days max
      select: { premium: true, asOfDate: true },
    });

    if (metrics.length === 0) return 0;

    let consecutiveDays = 0;
    for (const metric of metrics) {
      if (!metric.premium) break;

      const premiumValue = Number(metric.premium);
      const meetsThreshold =
        direction === 'PREMIUM' ? premiumValue > threshold : premiumValue < -threshold;

      if (meetsThreshold) {
        consecutiveDays++;
      } else {
        break;
      }
    }

    return consecutiveDays;
  }

  /**
   * Calculate premium/discount statistics over a period
   */
  async getPremiumDiscountStats(
    instrumentId: string,
    days: number
  ): Promise<{ mean: number; stdDev: number; current: number } | null> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const metrics = await this.prisma.etfMetrics.findMany({
      where: {
        instrumentId,
        asOfDate: { gte: cutoffDate },
        premium: { not: null },
      },
      orderBy: { asOfDate: 'desc' },
      select: { premium: true },
    });

    if (metrics.length < 2) return null;

    const values = metrics.map((m) => Number(m.premium));
    const current = values[0];
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    return { mean, stdDev, current };
  }
}
