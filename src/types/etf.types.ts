import { Decimal } from '@prisma/client/runtime/library';

/**
 * ETF Metrics Record
 * Time-series NAV, premium/discount, and AP metrics
 */
export interface EtfMetricsRecord {
  id: string;
  instrumentId: string;

  // Pricing metrics
  nav: Decimal | null;
  marketPrice: Decimal | null;
  premium: Decimal | null;

  // AP metrics
  activeApCount: number | null;
  topThreeApShare: Decimal | null;
  hhi: Decimal | null;

  // Creation/redemption flows
  creationUnits: Decimal | null;
  redemptionUnits: Decimal | null;
  netFlowUnits: Decimal | null;

  asOfDate: Date;
  sourceType: 'N-CEN' | 'N-PORT' | 'CALCULATED';
  filingId: string | null;
  createdAt: Date;
}

/**
 * Input for creating/upserting ETF metrics
 */
export interface CreateEtfMetricsInput {
  instrumentId: string;
  nav?: Decimal | null;
  marketPrice?: Decimal | null;
  premium?: Decimal | null;
  activeApCount?: number | null;
  topThreeApShare?: Decimal | null;
  hhi?: Decimal | null;
  creationUnits?: Decimal | null;
  redemptionUnits?: Decimal | null;
  netFlowUnits?: Decimal | null;
  asOfDate: Date;
  sourceType: 'N-CEN' | 'N-PORT' | 'CALCULATED';
  filingId?: string | null;
}

/**
 * ETF AP Detail Record
 * Individual authorized participant information
 */
export interface EtfApDetailRecord {
  id: string;
  instrumentId: string;
  filingId: string;
  apName: string;
  apIdentifier: string | null;
  shareOfActivity: Decimal | null;
  isActive: boolean;
  asOfDate: Date;
  createdAt: Date;
}

/**
 * Input for creating/upserting AP detail
 */
export interface CreateEtfApDetailInput {
  instrumentId: string;
  filingId: string;
  apName: string;
  apIdentifier?: string | null;
  shareOfActivity?: Decimal | null;
  isActive?: boolean;
  asOfDate: Date;
}

/**
 * NAV Calculation Result
 */
export interface NavCalculationResult {
  nav: Decimal;
  totalPortfolioValue: Decimal;
  sharesOutstanding: Decimal;
  holdingsCount: number;
  calculationDate: Date;
}

/**
 * Premium/Discount Statistics
 */
export interface PremiumDiscountStats {
  mean: number;
  stdDev: number;
  current: number;
  zScore: number;
  min: number;
  max: number;
  sampleSize: number;
}

/**
 * Holding from N-PORT filing
 */
export interface NPortHolding {
  name: string;
  cusip?: string;
  isin?: string;
  shares: Decimal;
  price: Decimal;
  value: Decimal;
  percentOfNav?: number;
}

/**
 * AP Concentration Metrics
 */
export interface ApConcentrationMetrics {
  activeApCount: number;
  topThreeApShare: number;
  hhi: number;
  giniCoefficient?: number;
}
