# Backend Gap Report

## EXECUTIVE SUMMARY
- **Current system status:** Partially Working
- **High-risk gaps:**
  - Polymarket on-chain indexing is effectively disabled because registry/state addresses and ABIs are placeholders; full sync yields zero markets and state calls can’t resolve. (`src/adapters/polymarket/polymarket.adapter.ts`)
  - Trade preparation builds a placeholder `fillOrder` call with dummy order data and a zero signature; it is not a valid on-chain trade. (`src/services/trade-execution/trade-execution.service.ts`)
  - Auth middleware expects `wallet` in route params, but `/api/v1/trades/prepare` only supplies `walletAddress` in the body, so authenticated trade preparation fails. (`src/middleware/auth.middleware.ts`, `src/routes/trades/prepare-trade.ts`)
  - Database is configured as SQLite in Prisma, not PostgreSQL as required. (`prisma/schema.prisma`)
- **Blocking issues:**
  - Live market indexing cannot populate markets without real registry/state addresses and ABIs.
  - Trade preparation endpoint is not usable due to auth param mismatch and placeholder transaction assembly.

## IMPLEMENTED FEATURES
- API layer with Fastify, CORS, rate limiting, and Swagger docs. (`src/server/app.ts`)
- Auth nonce issuance endpoint with EIP-712 signing message. (`src/routes/auth/nonce.ts`, `src/utils/signature-verification.ts`)
- Market read APIs: list, by-id, and orderbook endpoints. (`src/routes/markets/get-markets.ts`)
- Position read API and position update job wiring. (`src/routes/positions/get-positions.ts`, `src/jobs/position-update.job.ts`)
- Market sync job wiring for indexer execution. (`src/jobs/market-sync.job.ts`)
- Adapter interface for blockchain access and Viem implementation. (`src/adapters/blockchain/blockchain.adapter.ts`, `src/adapters/blockchain/viem.adapter.ts`)
- Prisma repositories for markets, orderbook snapshots, trades, and positions. (`src/adapters/database/repositories/*.ts`)
- In-memory LRU cache for markets and orderbooks (read paths in `getMarketById`/`getOrderbook`). (`src/services/market-data/market-data.service.ts`, `src/services/market-data/market-cache.service.ts`)

## PLACEHOLDERS & STUBS
- `src/adapters/polymarket/polymarket.adapter.ts`
  - **Description:** `NETWORK_CONFIG` uses zero addresses; registry/state ABIs are TODO placeholders; `getMarketById` does a full scan via `getAllMarkets` instead of direct lookup.
  - **Why it matters:** Indexer cannot query real markets or state; full sync returns empty and incremental sync never updates market data from chain.
  - **Required implementation:** Wire official registry/state contract addresses, replace ABIs with official Polymarket ABIs, and implement direct `getMarketById` lookup.

- `src/services/trade-execution/trade-execution.service.ts`
  - **Description:** `buildTransaction` encodes a placeholder `fillOrder` with dummy order data, zero signature, and synthetic maker/taker amounts; comments note missing real order logic.
  - **Why it matters:** The returned unsigned tx will fail on-chain or execute incorrect trades; it’s not a valid trade preparation flow.
  - **Required implementation:** Build actual order-matching logic using real orderbook data, construct correct `fillOrder` arguments, use real signed orders, and compute exact maker/taker amounts and fees.

- `src/services/market-data/market-data.service.ts`
  - **Description:** `buildSyntheticOrderbook` and `getOrderbook` fall back to synthetic orderbooks when no snapshot is available.
  - **Why it matters:** Trades and PnL calculations are based on synthetic single-level orderbooks, not actual liquidity or spreads.
  - **Required implementation:** Populate orderbook snapshots from a live source (CLOB API or on-chain) and avoid synthetic fallback for production trading paths.

- `src/middleware/auth.middleware.ts`
  - **Description:** Nonce storage is in-memory only; nonces are not invalidated after successful auth.
  - **Why it matters:** Nonces are lost on restart and signatures can be replayed until TTL expiry.
  - **Required implementation:** Persist nonce store in Redis/DB, delete nonce after successful verification, and enforce single-use signatures.

## MISSING FEATURES

### Phase 1
- **Trade preparation endpoint is not functional end-to-end** due to auth param mismatch and placeholder transaction assembly. (`src/middleware/auth.middleware.ts`, `src/routes/trades/prepare-trade.ts`, `src/services/trade-execution/trade-execution.service.ts`)
- **Wallet-based authentication is incomplete** for production use: nonce storage is memory-only and signatures are replayable. (`src/middleware/auth.middleware.ts`)
- **Position tracking data ingestion is absent**: no trade ingestion pipeline writes to `trades` or triggers `updatePositionFromTrade`. Positions can only be updated if trades are inserted externally. (`src/services/position-tracking/position-tracking.service.ts`, `src/adapters/database/repositories/trade.repository.ts`)

### Phase 2
- **Polymarket market indexing is not wired to real contracts** (zero addresses, placeholder ABIs). (`src/adapters/polymarket/polymarket.adapter.ts`)
- **Read-through caching is only partial**: list endpoints always hit DB; cache only used for single-market and orderbook reads. (`src/services/market-data/market-data.service.ts`)
- **Adapter-based chain access is incomplete for Polymarket**: the CLOB adapter is unused and there is no live orderbook ingestion path. (`src/adapters/polymarket/clob-client.adapter.ts`, `src/services/market-data/polymarket-indexer.service.ts`)
- **PostgreSQL persistence is not implemented**: Prisma is configured for SQLite. (`prisma/schema.prisma`)

## TECHNICAL DEBT & REFACTOR NOTES
- `src/middleware/auth.middleware.ts`: auth middleware assumes `wallet` exists in route params for all protected routes; this is brittle for body-based APIs.
- `src/services/market-data/polymarket-indexer.service.ts`: `volume24h` is never updated; only `volume` from chain state is used.
- `src/services/position-tracking/position-tracking.service.ts`: PnL uses synthetic mid-price; if no bids/asks, PnL uses zeros and can skew results.
- `src/adapters/polymarket/clob-client.adapter.ts`: adapter exists but is unused; integration path is unclear.
- `prisma/schema.prisma`: DB provider mismatch with intended Postgres stack.

## NEXT IMPLEMENTATION PRIORITIES
1. **Required before signals:** Wire real Polymarket market registry/state addresses and ABIs; make indexer produce real market records and prices. (`src/adapters/polymarket/polymarket.adapter.ts`, `src/services/market-data/polymarket-indexer.service.ts`)
2. **Required before signals:** Replace synthetic orderbooks with real orderbook ingestion (CLOB or on-chain), and write snapshots to DB. (`src/adapters/polymarket/clob-client.adapter.ts`, `src/adapters/database/repositories/orderbook.repository.ts`)
3. **Required before signals:** Fix auth middleware to validate signatures for trade prepare using body walletAddress (or add param) and enforce nonce single-use. (`src/middleware/auth.middleware.ts`, `src/routes/trades/prepare-trade.ts`)
4. **Required before signals:** Replace placeholder trade preparation with real order construction and `fillOrder` encoding. (`src/services/trade-execution/trade-execution.service.ts`)
5. **Required before AI agents:** Implement trade ingestion pipeline (from on-chain events or CLOB fills) to persist trades and drive position updates. (`src/adapters/database/repositories/trade.repository.ts`, `src/services/position-tracking/position-tracking.service.ts`)
6. **Required before AI agents:** Migrate Prisma datasource to PostgreSQL and verify schema compatibility. (`prisma/schema.prisma`)
