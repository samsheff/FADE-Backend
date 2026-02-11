-- CreateTable
CREATE TABLE "candles" (
    "id" TEXT NOT NULL,
    "market_id" TEXT,
    "instrument_id" TEXT,
    "interval" TEXT NOT NULL,
    "outcome" TEXT,
    "open" DECIMAL(20,10) NOT NULL,
    "high" DECIMAL(20,10) NOT NULL,
    "low" DECIMAL(20,10) NOT NULL,
    "close" DECIMAL(20,10) NOT NULL,
    "volume" DECIMAL(20,10) NOT NULL DEFAULT 0,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "candles_market_id_interval_timestamp_idx" ON "candles"("market_id", "interval", "timestamp");

-- CreateIndex
CREATE INDEX "candles_instrument_id_interval_timestamp_idx" ON "candles"("instrument_id", "interval", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "candles_market_id_instrument_id_interval_outcome_timestamp_s_key" ON "candles"("market_id", "instrument_id", "interval", "outcome", "timestamp", "source");
