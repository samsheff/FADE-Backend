# ETF Signals Implementation Summary

## Overview
Implemented ETF-specific structural signal detection to identify arbitrage breakdown and primary-market fragility in ETFs.

## Components Implemented

### 1. Schema Changes
**File**: `prisma/schema.prisma`

**New Models**:
- `EtfMetrics` - Time-series NAV, premium/discount, and AP metrics
- `EtfApDetail` - Individual authorized participant information

**New Enums**:
- `SignalType`: Added 7 new ETF signal types
  - `ETF_ARB_STRESS_PERSISTENT_DISCOUNT`
  - `ETF_ARB_STRESS_PERSISTENT_PREMIUM`
  - `ETF_ARB_STRESS_EXTREME_DEVIATION`
  - `ETF_ARB_IMPAIRED_ARBITRAGE_CHANNEL`
  - `ETF_AP_CONCENTRATION_HIGH`
  - `ETF_AP_COUNT_DECLINING`
  - `ETF_CREATION_REDEMPTION_ONE_WAY_BURST`

- `FactType`: Added 4 new ETF fact types
  - `ETF_NAV_DISCLOSED`
  - `ETF_PREMIUM_DISCOUNT_REPORTED`
  - `ETF_AP_LIST`
  - `ETF_CREATION_REDEMPTION_ACTIVITY`

**Relations Added**:
- `Instrument.etfMetrics` → `EtfMetrics[]`
- `Instrument.apDetails` → `EtfApDetail[]`
- `Filing.etfMetrics` → `EtfMetrics[]`
- `Filing.apDetails` → `EtfApDetail[]`

### 2. Type Definitions
**File**: `src/types/etf.types.ts`

Defines TypeScript interfaces for:
- `EtfMetricsRecord`, `CreateEtfMetricsInput`
- `EtfApDetailRecord`, `CreateEtfApDetailInput`
- `NavCalculationResult`, `PremiumDiscountStats`
- `NPortHolding`, `ApConcentrationMetrics`

**File**: `src/services/signals/types/generator.types.ts`

Added evidence types for signal generators:
- `PersistentDeviationEvidence`
- `ExtremeDeviationEvidence`
- `ApConcentrationEvidence`
- `ApCountDeclineEvidence`
- `OneWayFlowEvidence`

### 3. Repository Layer

**Files Created**:
- `src/adapters/database/repositories/etf-metrics.repository.ts`
  - CRUD operations for ETF metrics
  - Time-series queries (findHistoricalByInstrument, findByDateRange)
  - Premium/discount statistics calculations
  - Consecutive days detection

- `src/adapters/database/repositories/etf-ap-detail.repository.ts`
  - CRUD operations for AP details
  - AP count history tracking
  - Bulk upsert operations

**Files Modified**:
- `src/adapters/database/repositories/instrument.repository.ts`
  - Added `findByType(type: string)` method for querying by instrument type

### 4. Data Services

**File**: `src/services/etf/etf-nav-data.service.ts`
- Provides NAV and premium/discount time series
- Calculates premium/discount statistics (mean, stdDev, z-score)
- Detects consecutive premium/discount days
- Identifies extreme deviations (>2 std deviations)

**File**: `src/services/etf/etf-metrics-extraction.service.ts`
- Parses N-CEN filings to extract:
  - AP count and list
  - Creation/redemption data
  - HHI calculation
- Parses N-PORT filings to extract:
  - NAV from holdings
  - Portfolio valuation
- Calculates derived metrics (top-3 AP share, HHI)

### 5. Signal Generators

**File**: `src/services/signals/generators/etf-arbitrage-breakdown.generator.ts`

**Detection Rules**:
1. **Persistent Premium/Discount**: 7+ consecutive days with abs(premium) > 2%
   - Signals: `ETF_ARB_STRESS_PERSISTENT_DISCOUNT` / `ETF_ARB_STRESS_PERSISTENT_PREMIUM`
   - Score: `min(abs(premium) * 10, 100)`
   - Confidence: 1.0

2. **Extreme Z-Score Deviation**: premium/discount > 2 std deviations from 60-day mean
   - Signal: `ETF_ARB_STRESS_EXTREME_DEVIATION`
   - Score: `min(abs(zScore) * 30, 100)`
   - Confidence: `min(abs(zScore) / 3, 1.0)`

**File**: `src/services/signals/generators/etf-ap-fragility.generator.ts`

**Detection Rules**:
1. **High AP Concentration**: Top-3 > 60% OR HHI > 2500
   - Signal: `ETF_AP_CONCENTRATION_HIGH`
   - Score: Based on concentration level (50-90)
   - Confidence: 0.9

2. **Declining AP Count**: Monotonic decrease over 2+ filings
   - Signal: `ETF_AP_COUNT_DECLINING`
   - Score: `min(declineRate * 5, 100)`
   - Confidence: 0.95 (if 3+ filings), 0.75 (if 2 filings)

3. **One-Way Flow Burst**: 3+ consecutive periods of net creation OR redemption
   - Signal: `ETF_CREATION_REDEMPTION_ONE_WAY_BURST`
   - Score: `40 + consecutivePeriods * 10` (capped at 100)
   - Confidence: 0.85

**Special Features**:
- Both generators use 90-day expiration (not default 30 days) to align with quarterly N-PORT filing cycle

### 6. Jobs

**File**: `src/jobs/etf-metrics-enrichment.job.ts`
- Processes PARSED N-CEN/N-PORT filings
- Extracts metrics and stores in EtfMetrics table
- Extracts AP details and stores in EtfApDetail table
- Marks filings as ENRICHED
- Runs daily (configurable)

**File Modified**: `src/jobs/signal-computation.job.ts`
- Registered `ArbitrageBreakdownGenerator`
- Registered `APFragilityGenerator`
- Both generators run every 15 minutes with all other signal generators

### 7. Configuration

**File Modified**: `src/config/environment.ts`

Added environment variables:
```typescript
ETF_METRICS_ENRICHMENT_ENABLED: boolean (default: true)
ETF_METRICS_ENRICHMENT_INTERVAL_MS: number (default: 86400000 = 24 hours)
ETF_METRICS_BATCH_SIZE: number (default: 10)
```

## Database Migration

**Status**: Schema changes defined, migration pending
- Run `npx prisma generate` to regenerate Prisma client ✅ DONE
- Run `npx prisma migrate dev --name add_etf_signals` when database is available

## Verification Steps

### 1. Schema Migration
```bash
cd back
npx prisma generate  # Already done
npx prisma migrate dev --name add_etf_signals  # When DB is running
```

### 2. Test ETF Metrics Extraction
```typescript
// Example: Test extraction service
const service = new EtfMetricsExtractionService();
const filing = await filingRepo.findById('<n-cen-filing-id>');
const metrics = await service.extractMetricsFromNCEN(filing, '<instrument-id>');
// Verify metrics.nav, metrics.activeApCount, etc.
```

### 3. Test Signal Generation
```typescript
// Example: Test arbitrage breakdown generator
const generator = new ArbitrageBreakdownGenerator(instrumentRepo, navDataService);
const signals = await generator.generate({ currentTime: new Date(), lookbackWindowMs: 0 });
// Verify signals generated with correct severity, score, evidence
```

### 4. End-to-End Test
1. Start ETF metrics enrichment job
2. Verify metrics extracted from N-CEN/N-PORT filings
3. Start signal computation job
4. Verify signals generated from metrics
5. Check signal upsert idempotency (no duplicates on re-run)

### 5. Backfill Historical Data
```bash
# Run enrichment job with historical date range
# This will process existing PARSED N-CEN/N-PORT filings
```

## Environment Setup

Add to `.env`:
```env
# ETF Metrics Enrichment
ETF_METRICS_ENRICHMENT_ENABLED=true
ETF_METRICS_ENRICHMENT_INTERVAL_MS=86400000
ETF_METRICS_BATCH_SIZE=10
```

## Key Design Decisions

1. **NAV Data Source**: Calculate implied NAV from N-PORT holdings data
   - Parse N-PORT XML to extract individual holdings
   - Sum (shares × price) to calculate total portfolio value
   - More complex but enables frequent NAV updates (quarterly)

2. **Worker Architecture**: Integrated into existing SignalComputationJob
   - ETF generators run alongside existing generators
   - Unified logging and error handling
   - Runs every 15 minutes

3. **Signal Expiration**: 90 days (not default 30 days)
   - Aligns with quarterly N-PORT filing cycle
   - Signals remain active until next filing updates them

4. **Spread Data**: Skipped for now
   - Focus on persistent premium/discount and z-score deviation
   - ArbitrageBreakdownGenerator implements Rules 1 & 2 only
   - Future enhancement: add bid-ask spread tracking for Rule 3

## Files Created (11)
1. `prisma/schema.prisma` (MODIFIED)
2. `src/types/etf.types.ts`
3. `src/services/signals/types/generator.types.ts` (MODIFIED)
4. `src/adapters/database/repositories/etf-metrics.repository.ts`
5. `src/adapters/database/repositories/etf-ap-detail.repository.ts`
6. `src/adapters/database/repositories/instrument.repository.ts` (MODIFIED)
7. `src/services/etf/etf-nav-data.service.ts`
8. `src/services/etf/etf-metrics-extraction.service.ts`
9. `src/services/signals/generators/etf-arbitrage-breakdown.generator.ts`
10. `src/services/signals/generators/etf-ap-fragility.generator.ts`
11. `src/jobs/etf-metrics-enrichment.job.ts`
12. `src/jobs/signal-computation.job.ts` (MODIFIED)
13. `src/config/environment.ts` (MODIFIED)

## Next Steps

1. **Database Migration**: Run migration when database is available
2. **Job Registration**: Register `EtfMetricsEnrichmentJob` in main server/worker
3. **Testing**: Test extraction, signal generation, and end-to-end flow
4. **Monitoring**: Add metrics/logging for ETF signal detection
5. **Backfill**: Run enrichment on historical N-CEN/N-PORT filings

## Notes

- Prisma client has been regenerated with new schema changes
- All TypeScript code follows existing codebase patterns
- Signal generators follow the same architecture as existing generators
- ETF metrics extraction handles missing/incomplete data gracefully
- HHI and concentration calculations follow standard formulas
