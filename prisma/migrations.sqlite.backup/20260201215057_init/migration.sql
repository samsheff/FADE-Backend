-- CreateTable
CREATE TABLE "markets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "question" TEXT NOT NULL,
    "outcomes" JSONB NOT NULL,
    "expiryDate" DATETIME NOT NULL,
    "liquidity" DECIMAL NOT NULL,
    "volume24h" DECIMAL NOT NULL,
    "categoryTag" TEXT,
    "marketSlug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "tokens" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdated" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "trades" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletAddress" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "price" DECIMAL NOT NULL,
    "size" DECIMAL NOT NULL,
    "txHash" TEXT,
    "blockNumber" BIGINT,
    "gasUsed" BIGINT,
    "fee" DECIMAL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" DATETIME,
    CONSTRAINT "trades_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "positions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletAddress" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "avgPrice" DECIMAL NOT NULL,
    "size" DECIMAL NOT NULL,
    "realizedPnl" DECIMAL NOT NULL DEFAULT 0,
    "unrealizedPnl" DECIMAL NOT NULL DEFAULT 0,
    "lastTradeAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "positions_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "orderbook_snapshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "bids" JSONB NOT NULL,
    "asks" JSONB NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "markets_active_idx" ON "markets"("active");

-- CreateIndex
CREATE INDEX "markets_categoryTag_idx" ON "markets"("categoryTag");

-- CreateIndex
CREATE INDEX "markets_expiryDate_idx" ON "markets"("expiryDate");

-- CreateIndex
CREATE INDEX "trades_walletAddress_idx" ON "trades"("walletAddress");

-- CreateIndex
CREATE INDEX "trades_marketId_idx" ON "trades"("marketId");

-- CreateIndex
CREATE INDEX "trades_timestamp_idx" ON "trades"("timestamp");

-- CreateIndex
CREATE INDEX "positions_walletAddress_idx" ON "positions"("walletAddress");

-- CreateIndex
CREATE INDEX "positions_marketId_idx" ON "positions"("marketId");

-- CreateIndex
CREATE UNIQUE INDEX "positions_walletAddress_marketId_outcome_key" ON "positions"("walletAddress", "marketId", "outcome");

-- CreateIndex
CREATE INDEX "orderbook_snapshots_expiresAt_idx" ON "orderbook_snapshots"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "orderbook_snapshots_marketId_outcome_key" ON "orderbook_snapshots"("marketId", "outcome");
