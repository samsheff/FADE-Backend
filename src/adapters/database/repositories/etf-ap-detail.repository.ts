import { PrismaClient, EtfApDetail } from '@prisma/client';
import { CreateEtfApDetailInput, EtfApDetailRecord } from '../../../types/etf.types.js';

/**
 * Repository for ETF Authorized Participant (AP) details
 */
export class EtfApDetailRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Find latest AP details for an instrument
   */
  async findLatestByInstrument(instrumentId: string): Promise<EtfApDetailRecord[]> {
    const latestFiling = await this.prisma.etfApDetail.findFirst({
      where: { instrumentId },
      orderBy: { asOfDate: 'desc' },
      select: { asOfDate: true },
    });

    if (!latestFiling) return [];

    const apDetails = await this.prisma.etfApDetail.findMany({
      where: {
        instrumentId,
        asOfDate: latestFiling.asOfDate,
      },
      orderBy: { shareOfActivity: 'desc' },
    });

    return apDetails as EtfApDetailRecord[];
  }

  /**
   * Get AP count history for an instrument
   */
  async getApCountHistory(
    instrumentId: string,
    limit: number = 10
  ): Promise<Array<{ asOfDate: Date; count: number }>> {
    const result = await this.prisma.etfApDetail.groupBy({
      by: ['asOfDate'],
      where: {
        instrumentId,
        isActive: true,
      },
      _count: {
        apName: true,
      },
      orderBy: {
        asOfDate: 'desc',
      },
      take: limit,
    });

    return result.map((r) => ({
      asOfDate: r.asOfDate,
      count: r._count.apName,
    }));
  }

  /**
   * Upsert AP detail
   */
  async upsertApDetail(input: CreateEtfApDetailInput): Promise<EtfApDetailRecord> {
    const apDetail = await this.prisma.etfApDetail.upsert({
      where: {
        instrumentId_filingId_apName: {
          instrumentId: input.instrumentId,
          filingId: input.filingId,
          apName: input.apName,
        },
      },
      create: {
        instrumentId: input.instrumentId,
        filingId: input.filingId,
        apName: input.apName,
        apIdentifier: input.apIdentifier ?? null,
        shareOfActivity: input.shareOfActivity ?? null,
        isActive: input.isActive ?? true,
        asOfDate: input.asOfDate,
      },
      update: {
        apIdentifier: input.apIdentifier ?? null,
        shareOfActivity: input.shareOfActivity ?? null,
        isActive: input.isActive ?? true,
        asOfDate: input.asOfDate,
      },
    });

    return apDetail as EtfApDetailRecord;
  }

  /**
   * Find AP details for a specific filing
   */
  async findByFiling(filingId: string): Promise<EtfApDetailRecord[]> {
    const apDetails = await this.prisma.etfApDetail.findMany({
      where: { filingId },
      orderBy: { shareOfActivity: 'desc' },
    });

    return apDetails as EtfApDetailRecord[];
  }

  /**
   * Bulk upsert AP details
   */
  async bulkUpsertApDetails(inputs: CreateEtfApDetailInput[]): Promise<number> {
    let upsertedCount = 0;

    for (const input of inputs) {
      await this.upsertApDetail(input);
      upsertedCount++;
    }

    return upsertedCount;
  }
}
