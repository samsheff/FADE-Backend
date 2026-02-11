-- CreateTable
CREATE TABLE "market_backfills" (
    "marketId" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "tradeEventsCount" INTEGER NOT NULL DEFAULT 0,
    "orderbookEventsCount" INTEGER NOT NULL DEFAULT 0,
    "earliestTimestamp" DATETIME,
    "latestTimestamp" DATETIME,
    "errorMessage" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "market_backfills_status_idx" ON "market_backfills"("status");
