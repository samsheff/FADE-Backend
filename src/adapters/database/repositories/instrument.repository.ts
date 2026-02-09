import { Prisma, PrismaClient } from '@prisma/client';
import {
  InstrumentRecord,
  CreateInstrumentInput,
  UpdateInstrumentInput,
  InstrumentFilters,
  IdentifierType,
} from '../../../types/instrument.types.js';
import {
  InstrumentClassificationRecord,
  CompetitorRelationshipRecord,
  FactorExposureRecord,
  CreateInstrumentClassificationInput,
  CreateCompetitorRelationshipInput,
  CreateFactorExposureInput,
  IndustryType,
  SectorType,
} from '../../../types/document.types.js';
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

  async findByIdentifier(
    type: IdentifierType,
    value: string,
  ): Promise<InstrumentRecord | null> {
    const identifier = await this.prisma.instrumentIdentifier.findFirst({
      where: { type, value },
      include: {
        instrument: {
          include: {
            identifiers: true,
          },
        },
      },
    });

    return identifier ? this.toModel(identifier.instrument) : null;
  }

  async fuzzySearchByName(
    name: string,
    threshold = 0.8,
  ): Promise<Array<InstrumentRecord & { similarity: number }>> {
    // Simple implementation using PostgreSQL similarity
    // In production, consider using pg_trgm extension
    const instruments = await this.prisma.instrument.findMany({
      where: {
        OR: [
          { name: { contains: name, mode: 'insensitive' } },
          { symbol: { contains: name, mode: 'insensitive' } },
        ],
      },
      include: {
        identifiers: true,
      },
      take: 10,
    });

    return instruments.map((i) => ({
      ...this.toModel(i),
      similarity: this.calculateSimilarity(name.toLowerCase(), i.name.toLowerCase()),
    })).filter((i) => i.similarity >= threshold);
  }

  // ============================================================================
  // INSTRUMENT CLASSIFICATION
  // ============================================================================

  async upsertClassification(
    input: CreateInstrumentClassificationInput,
  ): Promise<InstrumentClassificationRecord> {
    const upserted = await this.prisma.instrumentClassification.upsert({
      where: {
        instrumentId: input.instrumentId,
      },
      create: {
        instrumentId: input.instrumentId,
        industry: input.industry,
        sector: input.sector,
        confidence: input.confidence || 1.0,
        rationale: input.rationale || null,
      },
      update: {
        industry: input.industry,
        sector: input.sector,
        confidence: input.confidence || 1.0,
        rationale: input.rationale || null,
        updatedAt: new Date(),
      },
    });

    return this.toClassificationModel(upserted);
  }

  async getClassification(
    instrumentId: string,
  ): Promise<InstrumentClassificationRecord | null> {
    const classification = await this.prisma.instrumentClassification.findUnique({
      where: { instrumentId },
    });

    return classification ? this.toClassificationModel(classification) : null;
  }

  async findByIndustry(
    industry: IndustryType,
    limit = 100,
  ): Promise<InstrumentRecord[]> {
    const classifications = await this.prisma.instrumentClassification.findMany({
      where: { industry },
      take: Number(limit),
      include: {
        instrument: {
          include: {
            identifiers: true,
          },
        },
      },
    });

    return classifications.map((c) => this.toModel(c.instrument));
  }

  async findBySector(
    sector: SectorType,
    limit = 100,
  ): Promise<InstrumentRecord[]> {
    const classifications = await this.prisma.instrumentClassification.findMany({
      where: { sector },
      take: Number(limit),
      include: {
        instrument: {
          include: {
            identifiers: true,
          },
        },
      },
    });

    return classifications.map((c) => this.toModel(c.instrument));
  }

  async findUnclassified(
    filters: { isActive?: boolean },
  ): Promise<InstrumentRecord[]> {
    const instruments = await this.prisma.instrument.findMany({
      where: {
        ...(filters.isActive !== undefined && { isActive: filters.isActive }),
        classification: null,
      },
      include: {
        identifiers: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return instruments.map((i) => this.toModel(i));
  }

  async findStaleClassifications(
    filters: { isActive?: boolean; staleDate: Date; limit?: number },
  ): Promise<InstrumentRecord[]> {
    const instruments = await this.prisma.instrument.findMany({
      where: {
        ...(filters.isActive !== undefined && { isActive: filters.isActive }),
        OR: [
          { classification: null },
          {
            classification: {
              updatedAt: { lt: filters.staleDate },
            },
          },
        ],
      },
      include: {
        identifiers: true,
      },
      take: Number(filters.limit || 100),
      orderBy: { createdAt: 'asc' },
    });

    return instruments.map((i) => this.toModel(i));
  }

  // ============================================================================
  // COMPETITOR RELATIONSHIPS
  // ============================================================================

  async createCompetitorRelationship(
    input: CreateCompetitorRelationshipInput,
  ): Promise<CompetitorRelationshipRecord> {
    const created = await this.prisma.competitorRelationship.create({
      data: {
        instrumentId: input.instrumentId,
        competitorId: input.competitorId,
        relationshipType: input.relationshipType,
        confidence: input.confidence || 0.7,
        rationale: input.rationale || null,
      },
    });

    return this.toCompetitorModel(created);
  }

  async findCompetitors(
    instrumentId: string,
    options?: { minConfidence?: number },
  ): Promise<CompetitorRelationshipRecord[]> {
    const relationships = await this.prisma.competitorRelationship.findMany({
      where: {
        instrumentId,
        ...(options?.minConfidence && {
          confidence: { gte: options.minConfidence },
        }),
      },
      orderBy: { confidence: 'desc' },
    });

    return relationships.map((r) => this.toCompetitorModel(r));
  }

  // ============================================================================
  // FACTOR EXPOSURES
  // ============================================================================

  async upsertFactorExposure(
    input: CreateFactorExposureInput,
  ): Promise<FactorExposureRecord> {
    const upserted = await this.prisma.factorExposure.upsert({
      where: {
        instrumentId_factorType: {
          instrumentId: input.instrumentId,
          factorType: input.factorType,
        },
      },
      create: {
        instrumentId: input.instrumentId,
        factorType: input.factorType,
        direction: input.direction,
        magnitude: input.magnitude,
        confidence: input.confidence || 0.7,
        rationale: input.rationale || null,
      },
      update: {
        direction: input.direction,
        magnitude: input.magnitude,
        confidence: input.confidence || 0.7,
        rationale: input.rationale || null,
        updatedAt: new Date(),
      },
    });

    return this.toFactorExposureModel(upserted);
  }

  async findFactorExposures(instrumentId: string): Promise<FactorExposureRecord[]>;
  async findFactorExposures(factorType: string): Promise<FactorExposureRecord[]>;
  async findFactorExposures(idOrType: string): Promise<FactorExposureRecord[]> {
    // Check if it's a factor type by checking if it's all caps with underscores
    const isFactorType = /^[A-Z_]+$/.test(idOrType);

    if (isFactorType) {
      // Find all exposures for this factor type
      const exposures = await this.prisma.factorExposure.findMany({
        where: { factorType: idOrType },
        orderBy: { magnitude: 'desc' },
      });

      return exposures.map((e) => this.toFactorExposureModel(e));
    } else {
      // Find exposures for a specific instrument
      const exposures = await this.prisma.factorExposure.findMany({
        where: { instrumentId: idOrType },
        orderBy: { magnitude: 'desc' },
      });

      return exposures.map((e) => this.toFactorExposureModel(e));
    }
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private calculateSimilarity(a: string, b: string): number {
    // Simple Levenshtein-based similarity
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    const longerLength = longer.length;

    if (longerLength === 0) return 1.0;

    const distance = this.levenshteinDistance(longer, shorter);
    return (longerLength - distance) / longerLength;
  }

  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1,
          );
        }
      }
    }

    return matrix[b.length][a.length];
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

  private toClassificationModel(prismaClassification: any): InstrumentClassificationRecord {
    return {
      id: prismaClassification.id,
      instrumentId: prismaClassification.instrumentId,
      industry: prismaClassification.industry,
      sector: prismaClassification.sector,
      confidence: prismaClassification.confidence.toString(),
      rationale: prismaClassification.rationale,
      classifiedAt: prismaClassification.classifiedAt,
      updatedAt: prismaClassification.updatedAt,
    };
  }

  private toCompetitorModel(prismaCompetitor: any): CompetitorRelationshipRecord {
    return {
      id: prismaCompetitor.id,
      instrumentId: prismaCompetitor.instrumentId,
      competitorId: prismaCompetitor.competitorId,
      relationshipType: prismaCompetitor.relationshipType,
      confidence: prismaCompetitor.confidence.toString(),
      rationale: prismaCompetitor.rationale,
      discoveredAt: prismaCompetitor.discoveredAt,
      updatedAt: prismaCompetitor.updatedAt,
    };
  }

  private toFactorExposureModel(prismaExposure: any): FactorExposureRecord {
    return {
      id: prismaExposure.id,
      instrumentId: prismaExposure.instrumentId,
      factorType: prismaExposure.factorType,
      direction: prismaExposure.direction,
      magnitude: prismaExposure.magnitude.toString(),
      confidence: prismaExposure.confidence.toString(),
      rationale: prismaExposure.rationale,
      discoveredAt: prismaExposure.discoveredAt,
      updatedAt: prismaExposure.updatedAt,
    };
  }
}
