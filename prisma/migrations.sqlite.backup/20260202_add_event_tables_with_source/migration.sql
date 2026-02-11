-- CreateTable
CREATE TABLE "orderbook_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "best_bid" DECIMAL,
    "best_ask" DECIMAL,
    "mid_price" DECIMAL,
    "timestamp" DATETIME NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'realtime'
);

-- CreateTable
CREATE TABLE "trade_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "price" DECIMAL NOT NULL,
    "size" DECIMAL NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'realtime'
);

-- CreateIndex
CREATE INDEX "orderbook_events_marketId_outcome_timestamp_idx" ON "orderbook_events"("marketId", "outcome", "timestamp");

-- CreateIndex
CREATE INDEX "orderbook_events_timestamp_idx" ON "orderbook_events"("timestamp");

-- CreateIndex
CREATE INDEX "orderbook_events_source_idx" ON "orderbook_events"("source");

-- CreateIndex
CREATE INDEX "trade_events_marketId_outcome_timestamp_idx" ON "trade_events"("marketId", "outcome", "timestamp");

-- CreateIndex
CREATE INDEX "trade_events_timestamp_idx" ON "trade_events"("timestamp");

-- CreateIndex
CREATE INDEX "trade_events_source_idx" ON "trade_events"("source");

-- CreateIndex (deduplication for idempotent backfills)
CREATE UNIQUE INDEX "trade_events_marketId_outcome_timestamp_price_size_key" ON "trade_events"("marketId", "outcome", "timestamp", "price", "size");
