# Historical Market Data

This document explains how historical market data is fetched, stored, and integrated into the Polymarket Terminal application.

## Overview

The Historical Market Data Backfill system populates charts and OHLC candles from market inception using Polymarket's Data API. This enables full historical context for market analysis, complementing real-time WebSocket data streams.

## Data Sources

### Polymarket Data API

- **Endpoint**: `https://data-api.polymarket.com/trades`
- **Data**: Historical trade executions with price, size, timestamp, and outcome
- **Availability**: Varies by market; typically starts from market creation but may have gaps
- **Rate Limits**: Conservative 1 request/second to avoid API throttling
- **Pagination**: Max 10,000 trades per request

### Data Model

Historical data is stored in two tables:

1. **TradeEvent** - Trade executions with price and volume
2. **OrderbookEvent** - Best bid/ask snapshots (optional synthesis from trades)

Both tables include a `source` field to distinguish between:
- `historical` - Backfilled from Data API
- `realtime` - Streamed from WebSocket

## Backfill Strategy

### Automatic Backfill

When new markets are discovered during sync, backfill is triggered automatically (non-blocking):

```typescript
// In PolymarketIndexer.fullSync()
if (!existing && this.historicalSync) {
  this.historicalSync.backfillNewMarkets([market.id]).catch(error => {
    this.logger.warn({ error, marketId: market.id }, 'Backfill failed');
  });
}
```

### Initial Backfill

On server startup, all markets with `pending` or `failed` backfill status are processed:

```typescript
// In MarketSyncJob.start()
this.runInitialBackfill().catch(error => {
  this.logger.error({ error }, 'Initial backfill failed');
});
```

### Manual Backfill

Use admin endpoints to trigger backfill manually:

```bash
# Trigger backfill for specific markets
curl -X POST http://localhost:3000/api/v1/admin/backfill \
  -H 'Content-Type: application/json' \
  -d '{"marketIds": ["0xabc..."]}'

# Trigger backfill for all pending/failed markets
curl -X POST http://localhost:3000/api/v1/admin/backfill

# Check backfill status
curl http://localhost:3000/api/v1/admin/backfill/status

# Check status for specific market
curl http://localhost:3000/api/v1/admin/backfill/0xabc...
```

## Backfill Status Tracking

The `market_backfills` table tracks backfill progress:

```sql
SELECT * FROM market_backfills WHERE marketId = '0xabc...';
```

Status values:
- `pending` - Not yet started
- `in_progress` - Currently backfilling
- `completed` - Successfully backfilled
- `failed` - Backfill failed (see errorMessage)

Key fields:
- `tradeEventsCount` - Number of historical trades inserted
- `earliestTimestamp` - Oldest available trade
- `latestTimestamp` - Newest historical trade
- `errorMessage` - Failure reason (if failed)

## Integration with Candles

The existing `CandleAggregator` seamlessly blends historical and real-time data:

```typescript
// Queries return both historical and realtime events
const events = await this.tradeRepo.findByMarket(marketId, outcome, from, to);
// Events are sorted by timestamp, source is transparent
```

No changes needed to candle generation logic - historical data is automatically included in charts!

## Known Limitations

### Data Availability

- **Not all markets have historical data** - The Data API may not have data from exact market inception
- **Gaps are possible** - Markets with low trading activity may have sparse historical data
- **API-dependent** - Historical data availability is limited to what Polymarket's API provides

### Performance Considerations

- **Backfill takes time** - Large markets with many trades may take several minutes to backfill
- **Rate limiting** - Conservative delays between API requests prevent throttling
- **Database write load** - Batch inserts optimize performance but still generate significant writes

### Edge Cases

- **Early-resolved markets** - Markets that ended early still backfill correctly
- **Inactive markets** - Markets with no trades won't have historical data (status still marked `completed`)
- **Time gaps** - Gap between `earliestTimestamp` and `market.createdAt` is expected and logged

## Operational Procedures

### Check Backfill Status

```bash
# Get all backfill statuses
curl http://localhost:3000/api/v1/admin/backfill/status

# Filter by status
curl http://localhost:3000/api/v1/admin/backfill/status?status=failed

# Limit results
curl http://localhost:3000/api/v1/admin/backfill/status?limit=10
```

### Retry Failed Backfills

```bash
# Get failed market IDs
curl http://localhost:3000/api/v1/admin/backfill/status?status=failed

# Retry specific markets
curl -X POST http://localhost:3000/api/v1/admin/backfill \
  -H 'Content-Type: application/json' \
  -d '{"marketIds": ["0xabc...", "0xdef..."], "skipIfCompleted": false}'
```

### Verify Data in Database

```sql
-- Check backfill status summary
SELECT status, COUNT(*)
FROM market_backfills
GROUP BY status;

-- Verify data sources
SELECT source, COUNT(*)
FROM trade_events
GROUP BY source;

-- Check specific market
SELECT
  COUNT(*) as trade_count,
  MIN(timestamp) as earliest,
  MAX(timestamp) as latest
FROM trade_events
WHERE marketId = '0xabc...' AND source = 'historical';

-- Verify no duplicates (should return 0 rows)
SELECT marketId, outcome, timestamp, price, size, COUNT(*)
FROM trade_events
GROUP BY marketId, outcome, timestamp, price, size
HAVING COUNT(*) > 1;
```

### Monitor Backfill Progress

```bash
# Watch logs during backfill
docker logs -f polymarket-terminal-api

# Look for log entries:
# - "Starting historical backfill for market"
# - "Fetched trade batch"
# - "Completed historical backfill for market"
# - "Backfill failed" (if errors occur)
```

## Configuration

Environment variables control backfill behavior:

```env
# Polymarket Data API URL
POLYMARKET_DATA_API_URL=https://data-api.polymarket.com

# Rate limiting between API requests (milliseconds)
HISTORICAL_BACKFILL_RATE_LIMIT_MS=1000

# Number of trades to fetch per request (max 10,000)
HISTORICAL_BACKFILL_BATCH_SIZE=5000
```

## Troubleshooting

### Backfill Stuck in `in_progress`

If a backfill is stuck (e.g., server crash during backfill):

```sql
-- Reset status to retry
UPDATE market_backfills
SET status = 'pending', errorMessage = NULL
WHERE marketId = '0xabc...' AND status = 'in_progress';
```

Then trigger backfill manually via API.

### Rate Limiting Errors (429)

If seeing frequent rate limit errors:

1. Increase `HISTORICAL_BACKFILL_RATE_LIMIT_MS` to 2000 or higher
2. Retry failed backfills during off-peak hours
3. The system has exponential backoff, but may need manual intervention

### Missing Historical Data

If candles don't show historical data:

1. Check backfill status for the market
2. Verify trades exist in `trade_events` with `source='historical'`
3. Check `earliestTimestamp` in backfill record - may not go back to market inception
4. Confirm market actually had trading activity during the time range

### Memory Issues

Large markets may cause memory pressure during backfill:

- Reduce `HISTORICAL_BACKFILL_BATCH_SIZE` to 1000 or 2000
- Process markets sequentially (default behavior)
- Monitor server memory during backfill operations

## Architecture Decisions

### Why Store Historical and Realtime Separately?

The `source` field enables:
- Deduplication (historical data never overwrites realtime data)
- Debugging (identify data origin)
- Reprocessing (clear and refill historical data without affecting realtime)
- Analytics (compare historical vs realtime data quality)

### Why Batch Inserts?

- **Performance** - 1000 inserts per transaction vs 1 insert per transaction
- **Idempotency** - `skipDuplicates: true` prevents duplicate data
- **Reliability** - Partial failures don't corrupt the dataset

### Why Non-Blocking Backfill?

- **Server startup** - Don't delay API availability waiting for backfill
- **User experience** - New markets are immediately queryable, historical data arrives later
- **Fault isolation** - Backfill failures don't crash the server

## Future Enhancements

Potential improvements not yet implemented:

1. **Orderbook reconstruction** - Synthesize full orderbook snapshots from trades
2. **Incremental backfill** - Only fetch new historical data (not all data every time)
3. **Parallel backfill** - Process multiple markets concurrently with semaphore
4. **Backfill metrics** - Prometheus metrics for monitoring backfill health
5. **Data validation** - Verify historical data quality (outlier detection, gap analysis)
6. **Compression** - Archive old historical data to reduce database size

## Related Documentation

- [Market Data API](./MARKET_DATA_API.md) - Real-time WebSocket streams
- [Database Schema](../prisma/schema.prisma) - Full data model
- [Candle Generation](./CANDLE_GENERATION.md) - OHLC aggregation logic
