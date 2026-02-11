# ETF Signals Quick Start Guide

## Prerequisites

1. Database running (PostgreSQL)
2. ETF instruments in the database (instrument_type = 'ETF')
3. N-CEN and N-PORT filings downloaded and parsed

## Setup Steps

### 1. Run Database Migration

```bash
cd back
npx prisma migrate dev --name add_etf_signals
```

This will:
- Create `etf_metrics` table
- Create `etf_ap_details` table
- Add new signal types to enums
- Add relations between tables

### 2. Update Environment Variables

Add to your `.env` file:

```env
# ETF Metrics Enrichment
ETF_METRICS_ENRICHMENT_ENABLED=true
ETF_METRICS_ENRICHMENT_INTERVAL_MS=86400000  # 24 hours
ETF_METRICS_BATCH_SIZE=10
```

### 3. Register ETF Enrichment Job

In your main worker/server file, register the ETF metrics enrichment job:

```typescript
import { EtfMetricsEnrichmentJob } from './jobs/etf-metrics-enrichment.job.js';

// In your startup code:
const etfMetricsJob = new EtfMetricsEnrichmentJob();
await etfMetricsJob.start();
```

The signal computation job (which includes ETF generators) is already updated and will run automatically if `SIGNAL_COMPUTATION_ENABLED=true`.

### 4. Test the Implementation

```bash
# Build the project
npm run build

# Run the test script
node dist/scripts/test-etf-signals.js
```

## How It Works

### Data Flow

```
1. N-CEN/N-PORT Filings (status = PARSED)
   ↓
2. EtfMetricsEnrichmentJob
   - Extracts NAV, AP count, creation/redemption data
   - Stores in etf_metrics and etf_ap_details tables
   - Marks filing as ENRICHED
   ↓
3. SignalComputationJob (runs every 15 minutes)
   - ArbitrageBreakdownGenerator reads etf_metrics
   - APFragilityGenerator reads etf_metrics and etf_ap_details
   - Generates signals based on detection rules
   ↓
4. Signals stored in instrument_signals table
```

### Signal Detection Rules

#### Arbitrage Breakdown Signals

1. **Persistent Premium/Discount** (`ETF_ARB_STRESS_PERSISTENT_DISCOUNT/PREMIUM`)
   - Triggers when: abs(premium/discount) > 2% for 7+ consecutive days
   - Indicates: ETF price persistently deviating from NAV

2. **Extreme Deviation** (`ETF_ARB_STRESS_EXTREME_DEVIATION`)
   - Triggers when: premium/discount > 2 standard deviations from 60-day mean
   - Indicates: Abnormal pricing deviation from historical patterns

#### AP Fragility Signals

1. **High Concentration** (`ETF_AP_CONCENTRATION_HIGH`)
   - Triggers when: Top-3 APs > 60% market share OR HHI > 2500
   - Indicates: Creation/redemption power concentrated in few APs

2. **Declining AP Count** (`ETF_AP_COUNT_DECLINING`)
   - Triggers when: Monotonic AP count decrease over 2+ filings
   - Indicates: APs exiting the market, reducing liquidity providers

3. **One-Way Flow** (`ETF_CREATION_REDEMPTION_ONE_WAY_BURST`)
   - Triggers when: 3+ consecutive periods of only creations OR redemptions
   - Indicates: Imbalanced flow suggesting stress or structural shift

## Manual Testing

### Test ETF Metrics Extraction

```typescript
import { EtfMetricsExtractionService } from './services/etf/etf-metrics-extraction.service.js';
import { FilingRepository } from './adapters/database/repositories/filing.repository.js';
import { InstrumentRepository } from './adapters/database/repositories/instrument.repository.js';

const filingRepo = new FilingRepository();
const instrumentRepo = new InstrumentRepository();
const extractionService = new EtfMetricsExtractionService();

// Find a test N-CEN filing
const filings = await filingRepo.findByType('FORM_N_CEN', 1);
const filing = filings[0];

// Find the ETF instrument by CIK
const instrument = await instrumentRepo.findByCik(filing.cik);

// Extract metrics
const metrics = await extractionService.extractMetricsFromNCEN(filing, instrument.id);
console.log('Extracted metrics:', metrics);
```

### Test Signal Generation

```typescript
import { ArbitrageBreakdownGenerator } from './services/signals/generators/etf-arbitrage-breakdown.generator.js';
import { InstrumentRepository } from './adapters/database/repositories/instrument.repository.js';
import { EtfNavDataService } from './services/etf/etf-nav-data.service.js';

const instrumentRepo = new InstrumentRepository();
const navService = new EtfNavDataService();
const generator = new ArbitrageBreakdownGenerator(instrumentRepo, navService);

const signals = await generator.generate({
  currentTime: new Date(),
  lookbackWindowMs: 0,
});

console.log(`Generated ${signals.length} signals`);
signals.forEach(signal => {
  console.log(`- ${signal.signalType}: ${signal.reason}`);
});
```

## Monitoring

### Check ETF Metrics

```sql
-- Check latest ETF metrics
SELECT
  i.symbol,
  em.nav,
  em.market_price,
  em.premium,
  em.active_ap_count,
  em.as_of_date
FROM etf_metrics em
JOIN instruments i ON i.id = em.instrument_id
ORDER BY em.as_of_date DESC
LIMIT 10;
```

### Check Generated Signals

```sql
-- Check recent ETF signals
SELECT
  i.symbol,
  s.signal_type,
  s.severity,
  s.score,
  s.reason,
  s.computed_at
FROM instrument_signals s
JOIN instruments i ON i.id = s.instrument_id
WHERE s.signal_type LIKE 'ETF_%'
ORDER BY s.computed_at DESC
LIMIT 20;
```

### Check AP Details

```sql
-- Check AP concentration for an ETF
SELECT
  i.symbol,
  ad.ap_name,
  ad.share_of_activity,
  ad.as_of_date
FROM etf_ap_details ad
JOIN instruments i ON i.id = ad.instrument_id
WHERE i.symbol = 'SPY'  -- Replace with your ETF
ORDER BY ad.as_of_date DESC, ad.share_of_activity DESC;
```

## Troubleshooting

### No Metrics Extracted

**Problem**: `etf_metrics` table is empty
**Solution**:
1. Check that N-CEN/N-PORT filings are marked as PARSED
2. Run ETF metrics enrichment job manually
3. Check logs for extraction errors
4. Verify filing content has expected sections

### No Signals Generated

**Problem**: `instrument_signals` table has no ETF signals
**Solution**:
1. Check that `etf_metrics` table has data
2. Run signal computation job manually
3. Check that confidence thresholds are met
4. Verify ETF instruments exist with type='ETF'

### Migration Fails

**Problem**: Prisma migration fails with conflict
**Solution**:
1. Check for existing ETF-related tables
2. If tables exist, drop them manually first
3. Re-run migration
4. Or use `prisma migrate resolve` to mark as applied

## Next Steps

1. **Create Test Data**: If you don't have real N-CEN/N-PORT filings, create test fixtures
2. **Backfill**: Run enrichment on all historical PARSED filings
3. **Monitor**: Watch logs for extraction and signal generation
4. **Tune Thresholds**: Adjust detection thresholds based on real-world data
5. **Add Alerts**: Set up notifications for high-severity ETF signals

## Support

For issues or questions:
1. Check logs in `./logs/` directory
2. Review `ETF_SIGNALS_IMPLEMENTATION.md` for architecture details
3. Run test script: `node dist/scripts/test-etf-signals.js`
