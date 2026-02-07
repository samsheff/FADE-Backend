export enum InstrumentType {
  EQUITY = 'EQUITY',
  OPTION = 'OPTION',
  FUTURE = 'FUTURE',
}

export enum InstrumentStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DELISTED = 'DELISTED',
  HALTED = 'HALTED',
}

export enum IdentifierType {
  CIK = 'CIK',
  CUSIP = 'CUSIP',
  ISIN = 'ISIN',
  FIGI = 'FIGI',
  TICKER = 'TICKER',
}

export interface InstrumentRecord {
  id: string;
  type: InstrumentType;
  status: InstrumentStatus;
  symbol: string;
  name: string;
  exchange: string | null;
  lastPrice: string | null;
  bidPrice: string | null;
  askPrice: string | null;
  currency: string;
  lotSize: string;
  tradeable: boolean;
  shortable: boolean;
  optionsAvailable: boolean;
  // Issuer Lifecycle
  isActive: boolean;
  firstSeenAt: Date | null;
  lastFilingAt: Date | null;
  metadataSource: string | null;
  formerNames: string[] | null;
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface InstrumentIdentifier {
  id: string;
  instrumentId: string;
  type: IdentifierType;
  value: string;
}

export interface CreateInstrumentInput {
  type: InstrumentType;
  status?: InstrumentStatus;
  symbol: string;
  name: string;
  exchange?: string;
  lastPrice?: string;
  bidPrice?: string;
  askPrice?: string;
  currency?: string;
  lotSize?: string;
  tradeable?: boolean;
  shortable?: boolean;
  optionsAvailable?: boolean;
}

export interface UpdateInstrumentInput {
  status?: InstrumentStatus;
  lastPrice?: string;
  bidPrice?: string;
  askPrice?: string;
  tradeable?: boolean;
  shortable?: boolean;
  optionsAvailable?: boolean;
}

export interface InstrumentFilters {
  type?: InstrumentType;
  status?: InstrumentStatus;
  symbol?: string;
  exchange?: string;
  isActive?: boolean;
  hasRecentFilings?: boolean;
  discoveredAfter?: Date;
  limit?: number;
  offset?: number;
}

// SEC EDGAR Universe Discovery Types

export interface SecFilerRecord {
  cik: string;
  ticker: string | null;
  title: string; // Legal entity name
}

export interface EdgarUniverseSyncRecord {
  id: string;
  syncStartedAt: Date;
  syncCompletedAt: Date;
  status: 'in_progress' | 'completed' | 'failed';
  totalIssuers: number;
  newIssuers: number;
  updatedIssuers: number;
  sourceUrl: string | null;
  sourceChecksum: string | null;
  errorMessage: string | null;
  createdAt: Date;
}
