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
  // EDGAR facts (existing)
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

  // Earnings transcript facts
  LIQUIDITY_LANGUAGE = 'LIQUIDITY_LANGUAGE',
  CAPITAL_RAISE_LANGUAGE = 'CAPITAL_RAISE_LANGUAGE',
  GUIDANCE_CUT = 'GUIDANCE_CUT',
  UNCERTAINTY_DISCLOSURE = 'UNCERTAINTY_DISCLOSURE',
  FDA_CATALYST_MENTION = 'FDA_CATALYST_MENTION',
  TRIAL_CATALYST_MENTION = 'TRIAL_CATALYST_MENTION',
  PRODUCT_LAUNCH_MENTION = 'PRODUCT_LAUNCH_MENTION',
  LAYOFF_ANNOUNCEMENT = 'LAYOFF_ANNOUNCEMENT',

  // News facts
  BANKRUPTCY_RISK_INDICATOR = 'BANKRUPTCY_RISK_INDICATOR',
  FINANCING_ANNOUNCEMENT = 'FINANCING_ANNOUNCEMENT',
  LITIGATION_ACTION = 'LITIGATION_ACTION',
  REGULATORY_ACTION = 'REGULATORY_ACTION',
  MA_ANNOUNCEMENT = 'MA_ANNOUNCEMENT',
  STRATEGIC_ALTERNATIVES = 'STRATEGIC_ALTERNATIVES',
  MANAGEMENT_TURNOVER = 'MANAGEMENT_TURNOVER',

  // Macro/Government facts
  INTEREST_RATE_DECISION = 'INTEREST_RATE_DECISION',
  CPI_RELEASE = 'CPI_RELEASE',
  UNEMPLOYMENT_DATA = 'UNEMPLOYMENT_DATA',
  INDUSTRIAL_PRODUCTION = 'INDUSTRIAL_PRODUCTION',
  CENTRAL_BANK_ANNOUNCEMENT = 'CENTRAL_BANK_ANNOUNCEMENT',

  // FDA/Clinical facts
  PDUFA_DATE = 'PDUFA_DATE',
  TRIAL_RESULT = 'TRIAL_RESULT',
  FDA_HOLD = 'FDA_HOLD',
  FDA_REJECTION = 'FDA_REJECTION',
  FDA_APPROVAL = 'FDA_APPROVAL',
  SAFETY_NOTICE = 'SAFETY_NOTICE',
}

export enum SignalType {
  // EDGAR signals (existing)
  DILUTION_RISK = 'DILUTION_RISK',
  TOXIC_FINANCING_RISK = 'TOXIC_FINANCING_RISK',
  DISTRESS_RISK = 'DISTRESS_RISK',
  VOLATILITY_SPIKE = 'VOLATILITY_SPIKE',

  // Earnings signals
  LIQUIDITY_STRESS_CALL = 'LIQUIDITY_STRESS_CALL',
  CAPITAL_RAISE_IMMINENT = 'CAPITAL_RAISE_IMMINENT',
  GUIDANCE_DETERIORATION = 'GUIDANCE_DETERIORATION',
  MANAGEMENT_UNCERTAINTY = 'MANAGEMENT_UNCERTAINTY',

  // News signals
  BANKRUPTCY_INDICATOR = 'BANKRUPTCY_INDICATOR',
  FINANCING_EVENT = 'FINANCING_EVENT',
  LEGAL_REGULATORY_RISK = 'LEGAL_REGULATORY_RISK',
  MA_SPECULATION = 'MA_SPECULATION',
  MANAGEMENT_INSTABILITY = 'MANAGEMENT_INSTABILITY',

  // Catalyst signals
  FDA_CATALYST_UPCOMING = 'FDA_CATALYST_UPCOMING',
  TRIAL_CATALYST_UPCOMING = 'TRIAL_CATALYST_UPCOMING',
  PRODUCT_LAUNCH_UPCOMING = 'PRODUCT_LAUNCH_UPCOMING',
  MACRO_EVENT_UPCOMING = 'MACRO_EVENT_UPCOMING',

  // Event outcome signals
  FDA_DECISION_SURPRISE = 'FDA_DECISION_SURPRISE',
  TRIAL_RESULT_SURPRISE = 'TRIAL_RESULT_SURPRISE',
  MACRO_SURPRISE = 'MACRO_SURPRISE',

  // Peer/Factor signals
  PEER_IMPACT = 'PEER_IMPACT',
  FACTOR_EXPOSURE_ALERT = 'FACTOR_EXPOSURE_ALERT',
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
  computedAt?: Date;
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
