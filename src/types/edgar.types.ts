export enum FilingType {
  FORM_8K = 'FORM_8K',
  FORM_10Q = 'FORM_10Q',
  FORM_10K = 'FORM_10K',
  FORM_424B5 = 'FORM_424B5',
  FORM_S3 = 'FORM_S3',
  ATM_FILING = 'ATM_FILING',
  PROXY_DEF14A = 'PROXY_DEF14A',
  OTHER = 'OTHER',
}

export enum FilingStatus {
  PENDING = 'PENDING',
  DOWNLOADING = 'DOWNLOADING',
  DOWNLOADED = 'DOWNLOADED',
  PARSED = 'PARSED',
  ENRICHED = 'ENRICHED',
  FAILED = 'FAILED',
}

export enum FactType {
  ATM_PROGRAM = 'ATM_PROGRAM',
  SHELF_REGISTRATION = 'SHELF_REGISTRATION',
  CONVERTIBLE_DEBT = 'CONVERTIBLE_DEBT',
  REVERSE_SPLIT = 'REVERSE_SPLIT',
  GOING_CONCERN = 'GOING_CONCERN',
  LIQUIDITY_STRESS = 'LIQUIDITY_STRESS',
  EQUITY_RAISE = 'EQUITY_RAISE',
  DIRECTOR_RESIGNATION = 'DIRECTOR_RESIGNATION',
  COVENANT_BREACH = 'COVENANT_BREACH',
  RESTATEMENT = 'RESTATEMENT',
}

export enum SignalType {
  DILUTION_RISK = 'DILUTION_RISK',
  TOXIC_FINANCING_RISK = 'TOXIC_FINANCING_RISK',
  DISTRESS_RISK = 'DISTRESS_RISK',
  VOLATILITY_SPIKE = 'VOLATILITY_SPIKE',
}

export enum SignalSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export interface FilingRecord {
  id: string;
  accessionNumber: string;
  cik: string;
  filingType: FilingType;
  filingDate: Date;
  status: FilingStatus;
  storagePath: string | null;
  contentHash: string | null;
  companyName: string | null;
  formType: string;
  reportDate: Date | null;
  errorMessage: string | null;
  downloadedAt: Date | null;
  parsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FilingContentRecord {
  id: string;
  filingId: string;
  fullText: string;
  sections: Record<string, string> | null;
  exhibits: Record<string, string> | null;
  wordCount: number;
  parsedAt: Date;
}

export interface FilingFactRecord {
  id: string;
  filingId: string;
  factType: FactType;
  data: Record<string, unknown>;
  evidence: string | null;
  confidence: string;
  extractedAt: Date;
}

export interface SignalRecord {
  id: string;
  instrumentId: string;
  signalType: SignalType;
  severity: SignalSeverity;
  score: string;
  reason: string;
  evidenceFacts: string[];
  sourceFiling: string | null;
  computedAt: Date;
  expiresAt: Date | null;
}

export interface FilingMetadata {
  accessionNumber: string;
  cik: string;
  filingType: FilingType;
  formType: string;
  filingDate: Date;
  companyName?: string;
  reportDate?: Date;
}

export interface EdgarSyncWatermarkRecord {
  id: string;
  cik: string;
  lastSyncedAt: Date;
  lastFilingDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFilingInput {
  accessionNumber: string;
  cik: string;
  filingType: FilingType;
  formType: string;
  filingDate: Date;
  companyName?: string;
  reportDate?: Date;
}

export interface UpdateFilingStatusInput {
  status: FilingStatus;
  storagePath?: string;
  contentHash?: string;
  errorMessage?: string;
  downloadedAt?: Date;
  parsedAt?: Date;
}

export interface CreateSignalInput {
  instrumentId: string;
  signalType: SignalType;
  severity: SignalSeverity;
  score: number;
  reason: string;
  evidenceFacts: string[];
  sourceFiling?: string;
  expiresAt?: Date;
}

export interface SignalFilters {
  instrumentId?: string;
  signalType?: SignalType;
  severity?: SignalSeverity;
  minScore?: number;
  limit?: number;
  offset?: number;
}

export interface FilingFilters {
  cik?: string;
  filingType?: FilingType;
  status?: FilingStatus;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}
