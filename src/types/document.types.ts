import { FilingStatus } from './edgar.types.js';

// ============================================================================
// ENUMS
// ============================================================================

export enum DocumentType {
  SEC_FILING = 'SEC_FILING',
  EARNINGS_TRANSCRIPT = 'EARNINGS_TRANSCRIPT',
  NEWS_ARTICLE = 'NEWS_ARTICLE',
  FDA_ANNOUNCEMENT = 'FDA_ANNOUNCEMENT',
  CLINICAL_TRIAL = 'CLINICAL_TRIAL',
  MACRO_EVENT = 'MACRO_EVENT',
}

export enum IndustryType {
  PHARMACEUTICAL = 'PHARMACEUTICAL',
  BIOTECHNOLOGY = 'BIOTECHNOLOGY',
  MINING = 'MINING',
  ENERGY = 'ENERGY',
  TECHNOLOGY = 'TECHNOLOGY',
  FINANCE = 'FINANCE',
  HEALTHCARE = 'HEALTHCARE',
  CONSUMER = 'CONSUMER',
  INDUSTRIAL = 'INDUSTRIAL',
  MATERIALS = 'MATERIALS',
  UTILITIES = 'UTILITIES',
  REAL_ESTATE = 'REAL_ESTATE',
  OTHER = 'OTHER',
}

export enum SectorType {
  HEALTHCARE = 'HEALTHCARE',
  MATERIALS = 'MATERIALS',
  ENERGY = 'ENERGY',
  FINANCIALS = 'FINANCIALS',
  CONSUMER_DISCRETIONARY = 'CONSUMER_DISCRETIONARY',
  CONSUMER_STAPLES = 'CONSUMER_STAPLES',
  INDUSTRIALS = 'INDUSTRIALS',
  TECHNOLOGY = 'TECHNOLOGY',
  COMMUNICATION_SERVICES = 'COMMUNICATION_SERVICES',
  UTILITIES = 'UTILITIES',
  REAL_ESTATE = 'REAL_ESTATE',
}

export enum FactorType {
  COMMODITY_GOLD = 'COMMODITY_GOLD',
  COMMODITY_SILVER = 'COMMODITY_SILVER',
  COMMODITY_OIL = 'COMMODITY_OIL',
  COMMODITY_NATURAL_GAS = 'COMMODITY_NATURAL_GAS',
  COMMODITY_COPPER = 'COMMODITY_COPPER',
  INTEREST_RATE_10Y = 'INTEREST_RATE_10Y',
  INTEREST_RATE_FED_FUNDS = 'INTEREST_RATE_FED_FUNDS',
  INDEX_SPX = 'INDEX_SPX',
  INDEX_NASDAQ = 'INDEX_NASDAQ',
  CURRENCY_USD = 'CURRENCY_USD',
  VOLATILITY_VIX = 'VOLATILITY_VIX',
}

// ============================================================================
// RECORDS
// ============================================================================

export interface DocumentRecord {
  id: string;
  documentType: DocumentType;
  sourceId: string;
  sourceUrl: string | null;
  title: string;
  publishedAt: Date;
  status: FilingStatus;
  storagePath: string | null;
  contentHash: string | null;
  metadata: Record<string, unknown> | null;
  errorMessage: string | null;
  downloadedAt: Date | null;
  parsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentContentRecord {
  id: string;
  documentId: string;
  fullText: string;
  structured: Record<string, unknown> | null;
  wordCount: number;
  parsedAt: Date;
}

export interface DocumentInstrumentRecord {
  id: string;
  documentId: string;
  instrumentId: string;
  relevance: string;
  matchMethod: string;
}

export interface DocumentFactRecord {
  id: string;
  documentId: string;
  factType: string;
  data: Record<string, unknown>;
  evidence: string | null;
  confidence: string;
  extractedAt: Date;
}

export interface InstrumentClassificationRecord {
  id: string;
  instrumentId: string;
  industry: IndustryType;
  sector: SectorType;
  confidence: string;
  rationale: string | null;
  classifiedAt: Date;
  updatedAt: Date;
}

export interface CompetitorRelationshipRecord {
  id: string;
  instrumentId: string;
  competitorId: string;
  relationshipType: string;
  confidence: string;
  rationale: string | null;
  discoveredAt: Date;
  updatedAt: Date;
}

export interface FactorExposureRecord {
  id: string;
  instrumentId: string;
  factorType: FactorType;
  direction: string;
  magnitude: string;
  confidence: string;
  rationale: string | null;
  discoveredAt: Date;
  updatedAt: Date;
}

export interface SyncWatermarkRecord {
  id: string;
  sourceType: string;
  sourceKey: string;
  lastSyncedAt: Date;
  lastItemDate: Date;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// INPUT TYPES
// ============================================================================

export interface CreateDocumentInput {
  documentType: DocumentType;
  sourceId: string;
  sourceUrl?: string;
  title: string;
  publishedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface UpdateDocumentStatusInput {
  status: FilingStatus;
  storagePath?: string;
  contentHash?: string;
  errorMessage?: string;
  downloadedAt?: Date;
  parsedAt?: Date;
}

export interface CreateDocumentContentInput {
  documentId: string;
  fullText: string;
  structured?: Record<string, unknown>;
  wordCount: number;
}

export interface CreateDocumentInstrumentInput {
  documentId: string;
  instrumentId: string;
  relevance: number;
  matchMethod: string;
}

export interface CreateDocumentFactInput {
  documentId: string;
  factType: string;
  data: Record<string, unknown>;
  evidence?: string;
  confidence?: number;
}

export interface CreateInstrumentClassificationInput {
  instrumentId: string;
  industry: IndustryType;
  sector: SectorType;
  confidence?: number;
  rationale?: string;
}

export interface CreateCompetitorRelationshipInput {
  instrumentId: string;
  competitorId: string;
  relationshipType: string;
  confidence?: number;
  rationale?: string;
}

export interface CreateFactorExposureInput {
  instrumentId: string;
  factorType: FactorType;
  direction: string;
  magnitude: number;
  confidence?: number;
  rationale?: string;
}

export interface UpsertSyncWatermarkInput {
  sourceType: string;
  sourceKey: string;
  lastSyncedAt: Date;
  lastItemDate: Date;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// FILTER TYPES
// ============================================================================

export interface DocumentFilters {
  documentType?: DocumentType;
  status?: FilingStatus;
  publishedAfter?: Date;
  publishedBefore?: Date;
  limit?: number;
  offset?: number;
}

export interface EntityResolutionResult {
  instrumentId: string;
  relevance: number;
  matchMethod: string;
}

// ============================================================================
// DOMAIN TYPES
// ============================================================================

export interface DocumentWithContent extends DocumentRecord {
  content: DocumentContentRecord | null;
  facts: DocumentFactRecord[];
  instruments: DocumentInstrumentRecord[];
}

export interface InstrumentWithClassification {
  instrumentId: string;
  classification: InstrumentClassificationRecord | null;
  competitors: CompetitorRelationshipRecord[];
  factorExposures: FactorExposureRecord[];
}

// ============================================================================
// CONNECTIONS API RESPONSE TYPES
// ============================================================================

export interface ConnectionClassification {
  sector: string;
  industry: string;
  confidence: number;
  classifiedAt: string;
}

export interface ConnectionCompetitor {
  instrumentId: string;
  name: string;
  symbol: string;
  relationshipType: string;
  confidence: number;
  discoveredAt: string;
}

export interface ConnectionFactorExposure {
  factorType: string;
  factorName: string;
  direction: string;
  magnitude: number;
  confidence: number;
  discoveredAt: string;
}

export interface ConnectionMetadata {
  totalCompetitors: number;
  totalFactorExposures: number;
  lastUpdated: string;
}

export interface InstrumentConnectionsResponse {
  classification: ConnectionClassification | null;
  competitors: ConnectionCompetitor[];
  factorExposures: ConnectionFactorExposure[];
  metadata: ConnectionMetadata;
}
