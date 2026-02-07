import { Prisma, PrismaClient } from '@prisma/client';
import {
  InstrumentRecord,
  CreateInstrumentInput,
  UpdateInstrumentInput,
  InstrumentFilters,
  IdentifierType,
} from '../../../types/instrument.types.js';
import { getPrismaClient } from '../client.js';

export class InstrumentRepository {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = getPrismaClient();
  }

  async findById(id: string): Promise<InstrumentRecord | null> {
    const instrument = await this.prisma.instrument.findUnique({
      where: { id },
      include: {
        identifiers: true,
      },
    });

    return instrument ? this.toModel(instrument) : null;
  }

  async findByCik(cik: string): Promise<InstrumentRecord | null> {
    const instrument = await this.prisma.instrument.findFirst({
      where: {
        identifiers: {
          some: {
            type: 'CIK',
            value: cik,
          },
        },
      },
      include: {
        identifiers: true,
      },
    });

    return instrument ? this.toModel(instrument) : null;
  }

  async findBySymbol(symbol: string, exchange?: string): Promise<InstrumentRecord | null> {
    const instrument = await this.prisma.instrument.findFirst({
      where: {
        symbol,
        ...(exchange && { exchange }),
      },
      include: {
        identifiers: true,
      },
    });

    return instrument ? this.toModel(instrument) : null;
  }

  async findMany(
    filters: InstrumentFilters,
  ): Promise<{ instruments: InstrumentRecord[]; total: number }> {
    const where: Prisma.InstrumentWhereInput = {
      ...(filters.type && { type: filters.type }),
      ...(filters.status && { status: filters.status }),
      ...(filters.symbol && { symbol: { contains: filters.symbol, mode: 'insensitive' } }),
      ...(filters.exchange && { exchange: filters.exchange }),
      ...(filters.isActive !== undefined && { isActive: filters.isActive }),
      ...(filters.hasRecentFilings !== undefined && {
        lastFilingAt: filters.hasRecentFilings
          ? { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
          : null,
      }),
      ...(filters.discoveredAfter && { firstSeenAt: { gte: filters.discoveredAfter } }),
    };

    const [instruments, total] = await Promise.all([
      this.prisma.instrument.findMany({
        where,
        include: {
          identifiers: true,
        },
        take: Number(filters.limit || 20),
        skip: Number(filters.offset || 0),
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.instrument.count({ where }),
    ]);

    return {
      instruments: instruments.map((i) => this.toModel(i)),
      total,
    };
  }

  async create(input: CreateInstrumentInput): Promise<InstrumentRecord> {
    const created = await this.prisma.instrument.create({
      data: {
        type: input.type,
        status: input.status || 'ACTIVE',
        symbol: input.symbol,
        name: input.name,
        exchange: input.exchange || null,
        lastPrice: input.lastPrice || null,
        bidPrice: input.bidPrice || null,
        askPrice: input.askPrice || null,
        currency: input.currency || 'USD',
        lotSize: input.lotSize || '1',
        tradeable: input.tradeable ?? true,
        shortable: input.shortable ?? false,
        optionsAvailable: input.optionsAvailable ?? false,
      },
      include: {
        identifiers: true,
      },
    });

    return this.toModel(created);
  }

  async update(id: string, input: UpdateInstrumentInput): Promise<InstrumentRecord> {
    const updated = await this.prisma.instrument.update({
      where: { id },
      data: input,
      include: {
        identifiers: true,
      },
    });

    return this.toModel(updated);
  }

  async upsertBySymbol(
    symbol: string,
    exchange: string | undefined,
    input: CreateInstrumentInput,
  ): Promise<InstrumentRecord> {
    const upserted = await this.prisma.instrument.upsert({
      where: {
        type_symbol_exchange: {
          type: input.type,
          symbol,
          exchange: exchange || null,
        },
      },
      create: {
        type: input.type,
        status: input.status || 'ACTIVE',
        symbol: input.symbol,
        name: input.name,
        exchange: input.exchange || null,
        lastPrice: input.lastPrice || null,
        bidPrice: input.bidPrice || null,
        askPrice: input.askPrice || null,
        currency: input.currency || 'USD',
        lotSize: input.lotSize || '1',
        tradeable: input.tradeable ?? true,
        shortable: input.shortable ?? false,
        optionsAvailable: input.optionsAvailable ?? false,
      },
      update: {
        status: input.status,
        name: input.name,
        lastPrice: input.lastPrice,
        bidPrice: input.bidPrice,
        askPrice: input.askPrice,
        tradeable: input.tradeable,
        shortable: input.shortable,
        optionsAvailable: input.optionsAvailable,
      },
      include: {
        identifiers: true,
      },
    });

    return this.toModel(upserted);
  }

  async addIdentifier(
    instrumentId: string,
    type: IdentifierType,
    value: string,
  ): Promise<void> {
    await this.prisma.instrumentIdentifier.upsert({
      where: {
        instrumentId_type: {
          instrumentId,
          type,
        },
      },
      create: {
        instrumentId,
        type,
        value,
      },
      update: {
        value,
      },
    });
  }

  private toModel(prismaInstrument: any): InstrumentRecord {
    return {
      id: prismaInstrument.id,
      type: prismaInstrument.type,
      status: prismaInstrument.status,
      symbol: prismaInstrument.symbol,
      name: prismaInstrument.name,
      exchange: prismaInstrument.exchange,
      lastPrice: prismaInstrument.lastPrice ? prismaInstrument.lastPrice.toString() : null,
      bidPrice: prismaInstrument.bidPrice ? prismaInstrument.bidPrice.toString() : null,
      askPrice: prismaInstrument.askPrice ? prismaInstrument.askPrice.toString() : null,
      currency: prismaInstrument.currency,
      lotSize: prismaInstrument.lotSize.toString(),
      tradeable: prismaInstrument.tradeable,
      shortable: prismaInstrument.shortable,
      optionsAvailable: prismaInstrument.optionsAvailable,
      isActive: prismaInstrument.isActive,
      firstSeenAt: prismaInstrument.firstSeenAt,
      lastFilingAt: prismaInstrument.lastFilingAt,
      metadataSource: prismaInstrument.metadataSource,
      formerNames: prismaInstrument.formerNames as string[] | null,
      createdAt: prismaInstrument.createdAt,
      updatedAt: prismaInstrument.updatedAt,
    };
  }
}
