import { Prisma, PrismaClient } from '@prisma/client';
import {
  SignalRecord,
  CreateSignalInput,
  SignalFilters,
  SignalType,
  SignalSeverity,
} from '../../../types/edgar.types.js';
import { getPrismaClient } from '../client.js';

export class SignalRepository {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = getPrismaClient();
  }

  async findById(id: string): Promise<SignalRecord | null> {
    const signal = await this.prisma.instrumentSignal.findUnique({
      where: { id },
    });

    return signal ? this.toModel(signal) : null;
  }

  async findActiveSignals(filters: SignalFilters): Promise<{
    signals: SignalRecord[];
    total: number;
  }> {
    const where: Prisma.InstrumentSignalWhereInput = {
      ...(filters.instrumentId && { instrumentId: filters.instrumentId }),
      ...(filters.signalType && { signalType: filters.signalType }),
      ...(filters.severity && { severity: filters.severity }),
      ...(filters.minScore && { score: { gte: filters.minScore } }),
      // Only active signals (not expired)
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    };

    const [signals, total] = await Promise.all([
      this.prisma.instrumentSignal.findMany({
        where,
        take: Number(filters.limit || 20),
        skip: Number(filters.offset || 0),
        orderBy: [
          { severity: 'desc' },
          { score: 'desc' },
          { computedAt: 'desc' },
        ],
      }),
      this.prisma.instrumentSignal.count({ where }),
    ]);

    return {
      signals: signals.map((s) => this.toModel(s)),
      total,
    };
  }

  async findByInstrument(instrumentId: string): Promise<SignalRecord[]> {
    const signals = await this.prisma.instrumentSignal.findMany({
      where: {
        instrumentId,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: [
        { severity: 'desc' },
        { score: 'desc' },
      ],
    });

    return signals.map((s) => this.toModel(s));
  }

  async findByType(
    signalType: SignalType,
    minSeverity?: SignalSeverity,
  ): Promise<SignalRecord[]> {
    const severityOrder = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    const minSeverityIndex = minSeverity ? severityOrder.indexOf(minSeverity) : 0;
    const allowedSeverities = severityOrder.slice(minSeverityIndex);

    const signals = await this.prisma.instrumentSignal.findMany({
      where: {
        signalType,
        severity: {
          in: allowedSeverities as any[],
        },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: [
        { severity: 'desc' },
        { score: 'desc' },
      ],
    });

    return signals.map((s) => this.toModel(s));
  }

  /**
   * Find recent signals of a specific type computed after a given date
   * Used for signal propagation
   */
  async findRecentSignals(
    signalType: SignalType,
    since: Date,
  ): Promise<SignalRecord[]> {
    const signals = await this.prisma.instrumentSignal.findMany({
      where: {
        signalType,
        computedAt: {
          gte: since,
        },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: {
        computedAt: 'desc',
      },
    });

    return signals.map((s) => this.toModel(s));
  }

  async upsertSignal(input: CreateSignalInput): Promise<SignalRecord> {
    // Find existing signal of same type for this instrument
    const existing = await this.prisma.instrumentSignal.findFirst({
      where: {
        instrumentId: input.instrumentId,
        signalType: input.signalType,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
    });

    if (existing) {
      // Update existing signal
      const updated = await this.prisma.instrumentSignal.update({
        where: { id: existing.id },
        data: {
          severity: input.severity,
          score: input.score,
          reason: input.reason,
          evidenceFacts: input.evidenceFacts,
          sourceFiling: input.sourceFiling,
          expiresAt: input.expiresAt,
          computedAt: input.computedAt ?? new Date(),
        },
      });

      return this.toModel(updated);
    } else {
      // Create new signal
      const created = await this.prisma.instrumentSignal.create({
        data: {
          instrumentId: input.instrumentId,
          signalType: input.signalType,
          severity: input.severity,
          score: input.score,
          reason: input.reason,
          evidenceFacts: input.evidenceFacts,
          sourceFiling: input.sourceFiling,
          computedAt: input.computedAt ?? new Date(),
          expiresAt: input.expiresAt,
        },
      });

      return this.toModel(created);
    }
  }

  async expireOldSignals(): Promise<number> {
    const result = await this.prisma.instrumentSignal.deleteMany({
      where: {
        expiresAt: {
          lte: new Date(),
        },
      },
    });

    return result.count;
  }

  async deleteSignal(id: string): Promise<void> {
    await this.prisma.instrumentSignal.delete({
      where: { id },
    });
  }

  async getSignalCounts(): Promise<Record<SignalType, Record<SignalSeverity, number>>> {
    const signals = await this.prisma.instrumentSignal.findMany({
      where: {
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      select: {
        signalType: true,
        severity: true,
      },
    });

    const counts: Record<string, Record<string, number>> = {};

    for (const signal of signals) {
      if (!counts[signal.signalType]) {
        counts[signal.signalType] = {};
      }
      if (!counts[signal.signalType][signal.severity]) {
        counts[signal.signalType][signal.severity] = 0;
      }
      counts[signal.signalType][signal.severity]++;
    }

    return counts as Record<SignalType, Record<SignalSeverity, number>>;
  }

  private toModel(prismaSignal: any): SignalRecord {
    return {
      id: prismaSignal.id,
      instrumentId: prismaSignal.instrumentId,
      signalType: prismaSignal.signalType,
      severity: prismaSignal.severity,
      score: prismaSignal.score.toString(),
      reason: prismaSignal.reason,
      evidenceFacts: prismaSignal.evidenceFacts as string[],
      sourceFiling: prismaSignal.sourceFiling,
      computedAt: prismaSignal.computedAt,
      expiresAt: prismaSignal.expiresAt,
    };
  }
}
