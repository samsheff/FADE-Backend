# Phase 2: Entity Enrichment - Verification Guide

## Overview
This guide provides step-by-step instructions to verify the Phase 2 implementation of the entity enrichment pipeline.

## Pre-deployment Checklist

### 1. Verify Prisma Migration
Ensure all database tables exist:

```bash
cd back
pnpm prisma migrate deploy
```

Verify tables in database:
```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('instrument_classifications', 'competitor_relationships', 'factor_exposures');
```

Expected: All 3 tables should exist.

### 2. Update Environment Configuration
Copy new config variables to your `.env` file:

```bash
# Entity Enrichment Configuration
ENTITY_ENRICHMENT_ENABLED=true
ENTITY_ENRICHMENT_INTERVAL_MS=604800000  # 7 days
ENTITY_ENRICHMENT_BATCH_SIZE=100
```

## Quick Test (Optional)

Before starting the full server, test classification on a single instrument:

```bash
cd back
tsx test-enrichment.ts
```

Expected output:
- Shows count of instruments in database
- Classifies first instrument
- Shows industry, sector, confidence, and rationale

## Full Integration Test

### 1. Start Server with Entity Enrichment Enabled

```bash
cd back
ENTITY_ENRICHMENT_ENABLED=true pnpm dev
```

Watch logs for:
1. `🏷️ Starting entity enrichment job...`
2. `Starting entity enrichment backfill`
3. `Found X unclassified instruments`
4. `Processing backfill batch...`
5. `Entity enrichment backfill complete` with stats
6. `✅ Entity enrichment job initialized and scheduled`

**Expected timeline:**
- Small database (<100 instruments): 1-2 minutes
- Medium database (100-500 instruments): 3-5 minutes
- Large database (500+ instruments): 5-10 minutes

### 2. Verify Classifications

```sql
-- Check that all active instruments are classified
SELECT COUNT(*) as unclassified
FROM instruments i
LEFT JOIN instrument_classifications ic ON i.id = ic.instrument_id
WHERE i.is_active = true AND ic.id IS NULL;
```
**Expected:** `0` (all instruments should be classified)

```sql
-- Sample classifications to verify quality
SELECT
  i.symbol,
  i.name,
  ic.industry,
  ic.sector,
  ROUND(ic.confidence::numeric, 2) as confidence,
  LEFT(ic.rationale, 100) as rationale
FROM instruments i
JOIN instrument_classifications ic ON i.id = ic.instrument_id
ORDER BY ic.confidence DESC
LIMIT 10;
```
**Expected:**
- Reasonable industry/sector mappings
- Confidence scores > 0.4
- Rationale shows matched keywords

### 3. Verify Competitor Relationships

```sql
-- Count competitor relationships by industry
SELECT
  ic.industry,
  COUNT(*) as relationship_count,
  COUNT(DISTINCT cr.instrument_id) as unique_instruments
FROM competitor_relationships cr
JOIN instrument_classifications ic ON cr.instrument_id = ic.instrument_id
GROUP BY ic.industry
ORDER BY relationship_count DESC;
```
**Expected:**
- Pharma/biotech should have many relationships
- All industries with multiple companies should have competitors

```sql
-- Verify bidirectionality (A→B and B→A both exist)
SELECT
  COUNT(*) as total_relationships,
  COUNT(DISTINCT instrument_id) as unique_instruments,
  ROUND(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT instrument_id), 0), 2) as avg_competitors_per_instrument
FROM competitor_relationships;
```
**Expected:** `avg_competitors_per_instrument` > 1 (companies should have multiple competitors)

### 4. Verify Factor Exposures

```sql
-- Check mining/energy companies have commodity exposures
SELECT
  i.symbol,
  i.name,
  ic.industry,
  fe.factor_type,
  ROUND(fe.magnitude::numeric, 2) as magnitude,
  fe.direction
FROM factor_exposures fe
JOIN instruments i ON fe.instrument_id = i.id
JOIN instrument_classifications ic ON i.id = ic.instrument_id
WHERE ic.industry IN ('MINING', 'ENERGY')
ORDER BY i.symbol, fe.magnitude DESC;
```
**Expected:** Mining companies should have `COMMODITY_GOLD`, `COMMODITY_SILVER`, `COMMODITY_COPPER`; Energy companies should have `COMMODITY_OIL`, `COMMODITY_NATURAL_GAS`

```sql
-- Verify all instruments have market beta
SELECT COUNT(DISTINCT instrument_id) as instruments_with_market_beta
FROM factor_exposures
WHERE factor_type = 'INDEX_SPX';

SELECT COUNT(*) as total_active_instruments
FROM instruments
WHERE is_active = true;
```
**Expected:** Both counts should be equal (all instruments have market beta)

```sql
-- Check finance/real estate have interest rate exposures
SELECT
  i.symbol,
  i.name,
  ic.industry,
  fe.factor_type,
  ROUND(fe.magnitude::numeric, 2) as magnitude,
  fe.direction
FROM factor_exposures fe
JOIN instruments i ON fe.instrument_id = i.id
JOIN instrument_classifications ic ON i.id = ic.instrument_id
WHERE ic.industry IN ('FINANCE', 'REAL_ESTATE')
  AND fe.factor_type LIKE 'INTEREST_RATE%'
ORDER BY i.symbol;
```
**Expected:** Finance/real estate companies should have `INTEREST_RATE_FED_FUNDS` and/or `INTEREST_RATE_10Y` with NEGATIVE direction

### 5. Test Weekly Refresh

Update a classification to make it stale:
```sql
UPDATE instrument_classifications
SET updated_at = NOW() - INTERVAL '31 days'
WHERE id = (SELECT id FROM instrument_classifications LIMIT 1);
```

Manually trigger enrichment:
```bash
# In Node REPL or test script
const { EntityEnrichmentJob } = require('./src/jobs/entity-enrichment.job.js');
const job = new EntityEnrichmentJob();
await job.runOnce();
```

Verify the stale classification was refreshed:
```sql
SELECT updated_at, industry, sector
FROM instrument_classifications
WHERE updated_at > NOW() - INTERVAL '1 minute'
ORDER BY updated_at DESC;
```
**Expected:** The previously stale classification should have been updated

### 6. Test Idempotency

Run the backfill twice and verify no duplicate relationships:

```bash
# Delete one classification
psql $DATABASE_URL -c "DELETE FROM instrument_classifications WHERE id = (SELECT id FROM instrument_classifications LIMIT 1);"

# Restart server (will re-run backfill)
ENTITY_ENRICHMENT_ENABLED=true pnpm dev

# Check for duplicate competitor relationships
SELECT instrument_id, competitor_id, COUNT(*) as count
FROM competitor_relationships
GROUP BY instrument_id, competitor_id
HAVING COUNT(*) > 1;
```
**Expected:** No duplicate rows (empty result set)

## Performance Verification

### Batch Processing Speed
Monitor logs during backfill to verify:
- Batch of 100 instruments completes in < 2 minutes
- No memory leaks (stable memory usage)
- Errors are logged but don't crash the job

### Weekly Run Performance
Trigger a regular run (after backfill is complete):
```bash
# Should process only stale instruments
const job = new EntityEnrichmentJob();
await job.runOnce();
```
**Expected:** Completes in < 30 seconds (only processes stale instruments, not full backfill)

## Success Criteria Summary

✅ All active instruments have `InstrumentClassification` record
✅ Pharma/biotech instruments have competitor mappings (bidirectional)
✅ Mining/energy instruments have commodity factor exposures
✅ Finance/real estate instruments have interest rate exposures
✅ All instruments have `INDEX_SPX` market beta exposure
✅ Job runs weekly on schedule without crashes
✅ No duplicate relationships after multiple runs (idempotent)
✅ Errors are logged but don't crash the job
✅ Classification confidence scores are reasonable (> 0.4 for matched industries)
✅ Weekly runs only process stale instruments (< 30 seconds)
✅ Backfill completes in reasonable time (< 10 minutes for 500+ instruments)

## Troubleshooting

### "No instruments found"
- Verify EDGAR universe discovery has run and populated instruments
- Check: `SELECT COUNT(*) FROM instruments WHERE is_active = true;`

### "Classification returned null"
- Check instrument has name/ticker: `SELECT id, symbol, name FROM instruments LIMIT 5;`
- Verify logger is not showing errors in classification service

### "Competitor relationships not created"
- Verify classifications exist first
- Check for unique constraint violations in logs (expected and ignored)

### "Factor exposures missing"
- Verify classifications exist first
- Check industry is mapped in `INDUSTRY_FACTOR_MAPPINGS`

### Job crashes during backfill
- Reduce `ENTITY_ENRICHMENT_BATCH_SIZE` (try 50 or 25)
- Check database connection pool size
- Look for specific error in logs (filing content fetch, DB constraint violations)

## Next Steps

After successful verification:
1. Monitor logs for first 24 hours
2. Verify weekly refresh runs as scheduled (check logs after 7 days)
3. Optionally tune keyword mappings in services if classification quality is poor
4. Proceed to Phase 3 (Signal Generation) when ready
