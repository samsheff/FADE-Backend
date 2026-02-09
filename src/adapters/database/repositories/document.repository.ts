import { Prisma, PrismaClient } from '@prisma/client';
import {
  DocumentRecord,
  DocumentContentRecord,
  DocumentFactRecord,
  DocumentInstrumentRecord,
  CreateDocumentInput,
  UpdateDocumentStatusInput,
  CreateDocumentContentInput,
  CreateDocumentInstrumentInput,
  CreateDocumentFactInput,
  DocumentFilters,
  DocumentType,
} from '../../../types/document.types.js';
import { FilingStatus } from '../../../types/edgar.types.js';
import { getPrismaClient } from '../client.js';

export class DocumentRepository {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = getPrismaClient();
  }

  // ============================================================================
  // DOCUMENT CRUD
  // ============================================================================

  async findById(id: string): Promise<DocumentRecord | null> {
    const document = await this.prisma.document.findUnique({
      where: { id },
    });

    return document ? this.toModel(document) : null;
  }

  async findBySourceId(sourceId: string): Promise<DocumentRecord | null> {
    const document = await this.prisma.document.findUnique({
      where: { sourceId },
    });

    return document ? this.toModel(document) : null;
  }

  async findBySourceIds(sourceIds: string[]): Promise<string[]> {
    const documents = await this.prisma.document.findMany({
      where: {
        sourceId: {
          in: sourceIds,
        },
      },
      select: {
        sourceId: true,
      },
    });

    return documents.map((d) => d.sourceId);
  }

  async findByStatus(
    status: FilingStatus,
    documentType?: DocumentType,
    limit = 10,
  ): Promise<DocumentRecord[]> {
    const documents = await this.prisma.document.findMany({
      where: {
        status,
        ...(documentType && { documentType }),
      },
      take: Number(limit),
      orderBy: { publishedAt: 'desc' },
    });

    return documents.map((d) => this.toModel(d));
  }

  async findByStatusAndType(
    status: FilingStatus,
    documentType: DocumentType,
    limit = 10,
  ): Promise<DocumentRecord[]> {
    const documents = await this.prisma.document.findMany({
      where: {
        status,
        documentType,
      },
      take: Number(limit),
      orderBy: { publishedAt: 'desc' },
    });

    return documents.map((d) => this.toModel(d));
  }

  async findMany(
    filters: DocumentFilters,
  ): Promise<{ documents: DocumentRecord[]; total: number }> {
    const where: Prisma.DocumentWhereInput = {
      ...(filters.documentType && { documentType: filters.documentType }),
      ...(filters.status && { status: filters.status }),
      ...(filters.publishedAfter && { publishedAt: { gte: filters.publishedAfter } }),
      ...(filters.publishedBefore && { publishedAt: { lte: filters.publishedBefore } }),
    };

    const [documents, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        take: Number(filters.limit || 20),
        skip: Number(filters.offset || 0),
        orderBy: { publishedAt: 'desc' },
      }),
      this.prisma.document.count({ where }),
    ]);

    return {
      documents: documents.map((d) => this.toModel(d)),
      total,
    };
  }

  async create(input: CreateDocumentInput): Promise<DocumentRecord> {
    const created = await this.prisma.document.create({
      data: {
        documentType: input.documentType,
        sourceId: input.sourceId,
        sourceUrl: input.sourceUrl || null,
        title: input.title,
        publishedAt: input.publishedAt,
        metadata: input.metadata || null,
        status: 'PENDING',
      },
    });

    return this.toModel(created);
  }

  async batchInsert(inputs: CreateDocumentInput[]): Promise<number> {
    const result = await this.prisma.document.createMany({
      data: inputs.map((input) => ({
        documentType: input.documentType,
        sourceId: input.sourceId,
        sourceUrl: input.sourceUrl || null,
        title: input.title,
        publishedAt: input.publishedAt,
        metadata: input.metadata || null,
        status: 'PENDING',
      })),
      skipDuplicates: true,
    });

    return result.count;
  }

  async updateStatus(
    id: string,
    status: FilingStatus,
    metadata?: Partial<UpdateDocumentStatusInput>,
  ): Promise<DocumentRecord> {
    const updated = await this.prisma.document.update({
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

  // ============================================================================
  // DOCUMENT CONTENT
  // ============================================================================

  async createContent(input: CreateDocumentContentInput): Promise<DocumentContentRecord> {
    const created = await this.prisma.documentContent.create({
      data: {
        documentId: input.documentId,
        fullText: input.fullText,
        structured: input.structured || null,
        wordCount: input.wordCount,
      },
    });

    return this.toContentModel(created);
  }

  async findContentById(documentId: string): Promise<DocumentContentRecord | null> {
    const content = await this.prisma.documentContent.findUnique({
      where: { documentId },
    });

    return content ? this.toContentModel(content) : null;
  }

  // ============================================================================
  // DOCUMENT-INSTRUMENT LINKING
  // ============================================================================

  async linkInstrument(input: CreateDocumentInstrumentInput): Promise<DocumentInstrumentRecord> {
    const created = await this.prisma.documentInstrument.create({
      data: {
        documentId: input.documentId,
        instrumentId: input.instrumentId,
        relevance: input.relevance,
        matchMethod: input.matchMethod,
      },
    });

    return this.toInstrumentLinkModel(created);
  }

  async batchLinkInstruments(
    inputs: CreateDocumentInstrumentInput[],
  ): Promise<number> {
    const result = await this.prisma.documentInstrument.createMany({
      data: inputs.map((input) => ({
        documentId: input.documentId,
        instrumentId: input.instrumentId,
        relevance: input.relevance,
        matchMethod: input.matchMethod,
      })),
      skipDuplicates: true,
    });

    return result.count;
  }

  async findInstrumentLinks(documentId: string): Promise<DocumentInstrumentRecord[]> {
    const links = await this.prisma.documentInstrument.findMany({
      where: { documentId },
      orderBy: { relevance: 'desc' },
    });

    return links.map((l) => this.toInstrumentLinkModel(l));
  }

  async findDocumentsByInstrument(
    instrumentId: string,
    limit = 20,
  ): Promise<DocumentRecord[]> {
    const links = await this.prisma.documentInstrument.findMany({
      where: { instrumentId },
      take: Number(limit),
      orderBy: { relevance: 'desc' },
      include: {
        document: true,
      },
    });

    return links.map((l) => this.toModel(l.document));
  }

  // ============================================================================
  // DOCUMENT FACTS
  // ============================================================================

  async createFact(input: CreateDocumentFactInput): Promise<DocumentFactRecord> {
    const created = await this.prisma.documentFact.create({
      data: {
        documentId: input.documentId,
        factType: input.factType as any,
        data: input.data,
        evidence: input.evidence || null,
        confidence: input.confidence || 1.0,
      },
    });

    return this.toFactModel(created);
  }

  async batchInsertFacts(inputs: CreateDocumentFactInput[]): Promise<number> {
    const result = await this.prisma.documentFact.createMany({
      data: inputs.map((input) => ({
        documentId: input.documentId,
        factType: input.factType as any,
        data: input.data,
        evidence: input.evidence || null,
        confidence: input.confidence || 1.0,
      })),
    });

    return result.count;
  }

  async findFactsByDocumentId(documentId: string): Promise<DocumentFactRecord[]> {
    const facts = await this.prisma.documentFact.findMany({
      where: { documentId },
      orderBy: { extractedAt: 'desc' },
    });

    return facts.map((f) => this.toFactModel(f));
  }

  async findFactsByInstrumentAndTypes(
    instrumentId: string,
    factTypes: string[],
  ): Promise<DocumentFactRecord[]> {
    const facts = await this.prisma.documentFact.findMany({
      where: {
        document: {
          instruments: {
            some: {
              instrumentId,
            },
          },
        },
        factType: {
          in: factTypes as any[],
        },
      },
      include: {
        document: true,
      },
      orderBy: { extractedAt: 'desc' },
    });

    return facts.map((f) => this.toFactModel(f));
  }

  // ============================================================================
  // PRIVATE MAPPERS
  // ============================================================================

  private toModel(prismaDocument: any): DocumentRecord {
    return {
      id: prismaDocument.id,
      documentType: prismaDocument.documentType,
      sourceId: prismaDocument.sourceId,
      sourceUrl: prismaDocument.sourceUrl,
      title: prismaDocument.title,
      publishedAt: prismaDocument.publishedAt,
      status: prismaDocument.status,
      storagePath: prismaDocument.storagePath,
      contentHash: prismaDocument.contentHash,
      metadata: prismaDocument.metadata as Record<string, unknown> | null,
      errorMessage: prismaDocument.errorMessage,
      downloadedAt: prismaDocument.downloadedAt,
      parsedAt: prismaDocument.parsedAt,
      createdAt: prismaDocument.createdAt,
      updatedAt: prismaDocument.updatedAt,
    };
  }

  private toContentModel(prismaContent: any): DocumentContentRecord {
    return {
      id: prismaContent.id,
      documentId: prismaContent.documentId,
      fullText: prismaContent.fullText,
      structured: prismaContent.structured as Record<string, unknown> | null,
      wordCount: prismaContent.wordCount,
      parsedAt: prismaContent.parsedAt,
    };
  }

  private toInstrumentLinkModel(prismaLink: any): DocumentInstrumentRecord {
    return {
      id: prismaLink.id,
      documentId: prismaLink.documentId,
      instrumentId: prismaLink.instrumentId,
      relevance: prismaLink.relevance.toString(),
      matchMethod: prismaLink.matchMethod,
    };
  }

  private toFactModel(prismaFact: any): DocumentFactRecord {
    return {
      id: prismaFact.id,
      documentId: prismaFact.documentId,
      factType: prismaFact.factType,
      data: prismaFact.data as Record<string, unknown>,
      evidence: prismaFact.evidence,
      confidence: prismaFact.confidence.toString(),
      extractedAt: prismaFact.extractedAt,
    };
  }
}
