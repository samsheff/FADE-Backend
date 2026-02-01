# Polymarket Indexer

## Indexing flow

- On boot, the `MarketSyncJob` runs a **full sync** via `PolymarketIndexer.fullSync()`.
- The indexer calls `PolymarketAdapter.getAllMarkets()` to pull market metadata/outcomes.
- For each market, it fetches on-chain state via `getMarketState()` and merges with existing DB data.
- The market record is upserted with `yes_price`, `no_price`, `liquidity`, `volume`, and `last_indexed_block`.
- Synthetic orderbook snapshots are written per outcome (bids/asks at the latest price).
- Cache entries for the affected market/orderbooks are invalidated.

## Incremental updates

- On each interval tick, `MarketSyncJob` runs `PolymarketIndexer.incrementalSync()`.
- It loads all markets from the database and calls `getMarketState()` for each.
- If `lastUpdatedBlock` is newer than `last_indexed_block`, the record is updated.
- Cache invalidation follows every successful update.

## Cache invalidation

- Cache is **read-through only** (reads populate it; writes do not).
- On successful indexing updates, the indexer deletes:
  - The market cache entry for that market.
  - Each outcome orderbook cache entry for that market.
- Cache TTLs are configurable via environment variables.

## Known limitations

- The adapter ABIs/addresses are placeholders; set `POLYMARKET_MARKET_REGISTRY_ADDRESS` and `POLYMARKET_MARKET_STATE_ADDRESS` to real contracts and update the placeholder ABIs.
- On-chain metadata availability varies; if registry data is incomplete, existing DB metadata is preserved.
- Orderbook snapshots are synthetic (single-level bids/asks at the last price). Replace with real CLOB-derived orderbooks if required.
- `volume24h` is preserved from existing DB values because 24h volume is not derivable directly from current on-chain state.
