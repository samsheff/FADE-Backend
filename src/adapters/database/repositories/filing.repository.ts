import { Prisma, PrismaClient } from '@prisma/client';
import {
  FilingRecord,
  FilingContentRecord,
  FilingFactRecord,
  CreateFilingInput,
  UpdateFilingStatusInput,
  FilingFilters,
  FilingStatus,
} from '../../../types/edgar.types.js';
import { getPrismaClient } from '../client.js';

export class FilingRepository {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = getPrismaClient();
  }

  async findById(id: string): Promise<FilingRecord | null> {
    const filing = await this.prisma.filing.findUnique({
      where: { id },
    });

    return filing ? this.toModel(filing) : null;
  }

  async findByAccessionNumber(accessionNumber: string): Promise<FilingRecord | null> {
    const filing = await this.prisma.filing.findUnique({
      where: { accessionNumber },
    });

    return filing ? this.toModel(filing) : null;
  }

  async findByAccessionNumbers(accessionNumbers: string[]): Promise<string[]> {
    const filings = await this.prisma.filing.findMany({
      where: {
        accessionNumber: {
          in: accessionNumbers,
        },
      },
      select: {
        accessionNumber: true,
      },
    });

    return filings.map((f) => f.accessionNumber);
  }

  async findByStatus(status: FilingStatus, limit = 10): Promise<FilingRecord[]> {
    const filings = await this.prisma.filing.findMany({
      where: { status },
      take: Number(limit), // Ensure it's a number for Prisma
      orderBy: { filingDate: 'desc' },
    });

    return filings.map((f) => this.toModel(f));
  }

  async findByCik(
    cik: string,
    filters?: FilingFilters,
  ): Promise<{ filings: FilingRecord[]; total: number }> {
    const where: Prisma.FilingWhereInput = {
      cik,
      ...(filters?.filingType && { filingType: filters.filingType }),
      ...(filters?.status && { status: filters.status }),
      ...(filters?.startDate && { filingDate: { gte: filters.startDate } }),
      ...(filters?.endDate && { filingDate: { lte: filters.endDate } }),
    };

    const [filings, total] = await Promise.all([
      this.prisma.filing.findMany({
        where,
        take: Number(filters?.limit || 20),
        skip: Number(filters?.offset || 0),
        orderBy: { filingDate: 'desc' },
      }),
      this.prisma.filing.count({ where }),
    ]);

    return {
      filings: filings.map((f) => this.toModel(f)),
      total,
    };
  }

  async findMany(filters: FilingFilters): Promise<{ filings: FilingRecord[]; total: number }> {
    const where: Prisma.FilingWhereInput = {
      ...(filters.cik && { cik: filters.cik }),
      ...(filters.filingType && { filingType: filters.filingType }),
      ...(filters.status && { status: filters.status }),
      ...(filters.startDate && { filingDate: { gte: filters.startDate } }),
      ...(filters.endDate && { filingDate: { lte: filters.endDate } }),
    };

    const [filings, total] = await Promise.all([
      this.prisma.filing.findMany({
        where,
        take: Number(filters.limit || 20),
        skip: Number(filters.offset || 0),
        orderBy: { filingDate: 'desc' },
      }),
      this.prisma.filing.count({ where }),
    ]);

    return {
      filings: filings.map((f) => this.toModel(f)),
      total,
    };
  }

  async create(input: CreateFilingInput): Promise<FilingRecord> {
    const created = await this.prisma.filing.create({
      data: {
        accessionNumber: input.accessionNumber,
        cik: input.cik,
        filingType: input.filingType,
        formType: input.formType,
        filingDate: input.filingDate,
        companyName: input.companyName || null,
        reportDate: input.reportDate || null,
        status: 'PENDING',
      },
    });

    return this.toModel(created);
  }

  async batchInsert(inputs: CreateFilingInput[]): Promise<number> {
    const result = await this.prisma.filing.createMany({
      data: inputs.map((input) => ({
        accessionNumber: input.accessionNumber,
        cik: input.cik,
        filingType: input.filingType,
        formType: input.formType,
        filingDate: input.filingDate,
        companyName: input.companyName || null,
        reportDate: input.reportDate || null,
        status: 'PENDING',
      })),
      skipDuplicates: true,
    });

    return result.count;
  }

  async updateStatus(
    id: string,
    status: FilingStatus,
    metadata?: Partial<UpdateFilingStatusInput>,
  ): Promise<FilingRecord> {
    const updated = await this.prisma.filing.update({
      where: { id },
      data: {
        status,
        storagePath: metadata?.storagePath,
        contentHash: metadata?.contentHash,
        errorMessage: metadata?.errorMessage,
        downloadedAt: metadata?.downloadedAt,
        parsedAt: metadata?.parsedAt,
      },
    });

    return this.toModel(updated);
  }

  // FilingContent methods
  async createContent(filingId: string, content: {
    fullText: string;
    sections?: Record<string, string>;
    exhibits?: Record<string, string>;
  }): Promise<FilingContentRecord> {
    const created = await this.prisma.filingContent.create({
      data: {
        filingId,
        fullText: content.fullText,
        sections: content.sections || null,
        exhibits: content.exhibits || null,
        wordCount: content.fullText.split(/\s+/).length,
      },
    });

    return this.toContentModel(created);
  }

  async findContentByFilingId(filingId: string): Promise<FilingContentRecord | null> {
    const content = await this.prisma.filingContent.findUnique({
      where: { filingId },
    });

    return content ? this.toContentModel(content) : null;
  }

  // FilingFact methods
  async createFact(fact: {
    filingId: string;
    factType: string;
    data: Record<string, unknown>;
    evidence?: string;
    confidence?: number;
  }): Promise<FilingFactRecord> {
    const created = await this.prisma.filingFact.create({
      data: {
        filingId: fact.filingId,
        factType: fact.factType as any,
        data: fact.data,
        evidence: fact.evidence || null,
        confidence: fact.confidence || 1.0,
      },
    });

    return this.toFactModel(created);
  }

  async batchInsertFacts(facts: Array<{
    filingId: string;
    factType: string;
    data: Record<string, unknown>;
    evidence?: string;
    confidence?: number;
  }>): Promise<number> {
    const result = await this.prisma.filingFact.createMany({
      data: facts.map((fact) => ({
        filingId: fact.filingId,
        factType: fact.factType as any,
        data: fact.data,
        evidence: fact.evidence || null,
        confidence: fact.confidence || 1.0,
      })),
    });

    return result.count;
  }

  async findFactsByFilingId(filingId: string): Promise<FilingFactRecord[]> {
    const facts = await this.prisma.filingFact.findMany({
      where: { filingId },
      orderBy: { extractedAt: 'desc' },
    });

    return facts.map((f) => this.toFactModel(f));
  }

  async findFactsByCik(cik: string, factTypes?: string[]): Promise<FilingFactRecord[]> {
    const facts = await this.prisma.filingFact.findMany({
      where: {
        filing: {
          cik,
        },
        ...(factTypes && factTypes.length > 0 && {
          factType: {
            in: factTypes as any[],
          },
        }),
      },
      include: {
        filing: true,
      },
      orderBy: { extractedAt: 'desc' },
    });

    return facts.map((f) => this.toFactModel(f));
  }

  private toModel(prismaFiling: any): FilingRecord {
    return {
      id: prismaFiling.id,
      accessionNumber: prismaFiling.accessionNumber,
      cik: prismaFiling.cik,
      filingType: prismaFiling.filingType,
      filingDate: prismaFiling.filingDate,
      status: prismaFiling.status,
      storagePath: prismaFiling.storagePath,
      contentHash: prismaFiling.contentHash,
      companyName: prismaFiling.companyName,
      formType: prismaFiling.formType,
      reportDate: prismaFiling.reportDate,
      errorMessage: prismaFiling.errorMessage,
      downloadedAt: prismaFiling.downloadedAt,
      parsedAt: prismaFiling.parsedAt,
      createdAt: prismaFiling.createdAt,
      updatedAt: prismaFiling.updatedAt,
    };
  }

  private toContentModel(prismaContent: any): FilingContentRecord {
    return {
      id: prismaContent.id,
      filingId: prismaContent.filingId,
      fullText: prismaContent.fullText,
      sections: prismaContent.sections as Record<string, string> | null,
      exhibits: prismaContent.exhibits as Record<string, string> | null,
      wordCount: prismaContent.wordCount,
      parsedAt: prismaContent.parsedAt,
    };
  }

  private toFactModel(prismaFact: any): FilingFactRecord {
    return {
      id: prismaFact.id,
      filingId: prismaFact.filingId,
      factType: prismaFact.factType,
      data: prismaFact.data as Record<string, unknown>,
      evidence: prismaFact.evidence,
      confidence: prismaFact.confidence.toString(),
      extractedAt: prismaFact.extractedAt,
    };
  }
}
