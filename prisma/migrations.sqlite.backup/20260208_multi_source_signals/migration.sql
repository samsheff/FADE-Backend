-- Multi-Source Signal Extension Migration
-- Phase 1: Foundation schema changes

-- ============================================================================
-- ENUMS: Extend existing + add new
-- ============================================================================

-- Document types (new)
CREATE TYPE "DocumentType" AS ENUM (
  'SEC_FILING',
  'EARNINGS_TRANSCRIPT',
  'NEWS_ARTICLE',
  'FDA_ANNOUNCEMENT',
  'CLINICAL_TRIAL',
  'MACRO_EVENT'
);

-- Industry types (new)
CREATE TYPE "IndustryType" AS ENUM (
  'PHARMACEUTICAL',
  'BIOTECHNOLOGY',
  'MINING',
  'ENERGY',
  'TECHNOLOGY',
  'FINANCE',
  'HEALTHCARE',
  'CONSUMER',
  'INDUSTRIAL',
  'MATERIALS',
  'UTILITIES',
  'REAL_ESTATE',
  'OTHER'
);

-- Sector types (new)
CREATE TYPE "SectorType" AS ENUM (
  'HEALTHCARE',
  'MATERIALS',
  'ENERGY',
  'FINANCIALS',
  'CONSUMER_DISCRETIONARY',
  'CONSUMER_STAPLES',
  'INDUSTRIALS',
  'TECHNOLOGY',
  'COMMUNICATION_SERVICES',
  'UTILITIES',
  'REAL_ESTATE'
);

-- Factor types (new)
CREATE TYPE "FactorType" AS ENUM (
  'COMMODITY_GOLD',
  'COMMODITY_SILVER',
  'COMMODITY_OIL',
  'COMMODITY_NATURAL_GAS',
  'COMMODITY_COPPER',
  'INTEREST_RATE_10Y',
  'INTEREST_RATE_FED_FUNDS',
  'INDEX_SPX',
  'INDEX_NASDAQ',
  'CURRENCY_USD',
  'VOLATILITY_VIX'
);

-- Extend FactType enum with new fact types
ALTER TYPE "FactType" ADD VALUE 'LIQUIDITY_LANGUAGE';
ALTER TYPE "FactType" ADD VALUE 'CAPITAL_RAISE_LANGUAGE';
ALTER TYPE "FactType" ADD VALUE 'GUIDANCE_CUT';
ALTER TYPE "FactType" ADD VALUE 'UNCERTAINTY_DISCLOSURE';
ALTER TYPE "FactType" ADD VALUE 'FDA_CATALYST_MENTION';
ALTER TYPE "FactType" ADD VALUE 'TRIAL_CATALYST_MENTION';
ALTER TYPE "FactType" ADD VALUE 'PRODUCT_LAUNCH_MENTION';
ALTER TYPE "FactType" ADD VALUE 'LAYOFF_ANNOUNCEMENT';
ALTER TYPE "FactType" ADD VALUE 'BANKRUPTCY_RISK_INDICATOR';
ALTER TYPE "FactType" ADD VALUE 'FINANCING_ANNOUNCEMENT';
ALTER TYPE "FactType" ADD VALUE 'LITIGATION_ACTION';
ALTER TYPE "FactType" ADD VALUE 'REGULATORY_ACTION';
ALTER TYPE "FactType" ADD VALUE 'MA_ANNOUNCEMENT';
ALTER TYPE "FactType" ADD VALUE 'STRATEGIC_ALTERNATIVES';
ALTER TYPE "FactType" ADD VALUE 'MANAGEMENT_TURNOVER';
ALTER TYPE "FactType" ADD VALUE 'INTEREST_RATE_DECISION';
ALTER TYPE "FactType" ADD VALUE 'CPI_RELEASE';
ALTER TYPE "FactType" ADD VALUE 'UNEMPLOYMENT_DATA';
ALTER TYPE "FactType" ADD VALUE 'INDUSTRIAL_PRODUCTION';
ALTER TYPE "FactType" ADD VALUE 'CENTRAL_BANK_ANNOUNCEMENT';
ALTER TYPE "FactType" ADD VALUE 'PDUFA_DATE';
ALTER TYPE "FactType" ADD VALUE 'TRIAL_RESULT';
ALTER TYPE "FactType" ADD VALUE 'FDA_HOLD';
ALTER TYPE "FactType" ADD VALUE 'FDA_REJECTION';
ALTER TYPE "FactType" ADD VALUE 'FDA_APPROVAL';
ALTER TYPE "FactType" ADD VALUE 'SAFETY_NOTICE';

-- Extend SignalType enum with new signal types
ALTER TYPE "SignalType" ADD VALUE 'LIQUIDITY_STRESS_CALL';
ALTER TYPE "SignalType" ADD VALUE 'CAPITAL_RAISE_IMMINENT';
ALTER TYPE "SignalType" ADD VALUE 'GUIDANCE_DETERIORATION';
ALTER TYPE "SignalType" ADD VALUE 'MANAGEMENT_UNCERTAINTY';
ALTER TYPE "SignalType" ADD VALUE 'BANKRUPTCY_INDICATOR';
ALTER TYPE "SignalType" ADD VALUE 'FINANCING_EVENT';
ALTER TYPE "SignalType" ADD VALUE 'LEGAL_REGULATORY_RISK';
ALTER TYPE "SignalType" ADD VALUE 'MA_SPECULATION';
ALTER TYPE "SignalType" ADD VALUE 'MANAGEMENT_INSTABILITY';
ALTER TYPE "SignalType" ADD VALUE 'FDA_CATALYST_UPCOMING';
ALTER TYPE "SignalType" ADD VALUE 'TRIAL_CATALYST_UPCOMING';
ALTER TYPE "SignalType" ADD VALUE 'PRODUCT_LAUNCH_UPCOMING';
ALTER TYPE "SignalType" ADD VALUE 'MACRO_EVENT_UPCOMING';
ALTER TYPE "SignalType" ADD VALUE 'FDA_DECISION_SURPRISE';
ALTER TYPE "SignalType" ADD VALUE 'TRIAL_RESULT_SURPRISE';
ALTER TYPE "SignalType" ADD VALUE 'MACRO_SURPRISE';
ALTER TYPE "SignalType" ADD VALUE 'PEER_IMPACT';
ALTER TYPE "SignalType" ADD VALUE 'FACTOR_EXPOSURE_ALERT';

-- ============================================================================
-- DOCUMENTS: Polymorphic storage for non-EDGAR sources
-- ============================================================================

CREATE TABLE "documents" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "document_type" "DocumentType" NOT NULL,

  -- Source identity
  "source_id" TEXT NOT NULL UNIQUE,
  "source_url" TEXT,

  -- Classification
  "title" TEXT NOT NULL,
  "published_at" TIMESTAMP(3) NOT NULL,

  -- Status pipeline (reusing FilingStatus)
  "status" "FilingStatus" NOT NULL DEFAULT 'PENDING',
  "storage_path" TEXT,
  "content_hash" TEXT,

  -- Metadata
  "metadata" JSONB,

  -- Processing
  "error_message" TEXT,
  "downloaded_at" TIMESTAMP(3),
  "parsed_at" TIMESTAMP(3),

  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "documents_type_status_idx" ON "documents"("document_type", "status");
CREATE INDEX "documents_published_at_idx" ON "documents"("published_at");

-- ============================================================================
-- DOCUMENT CONTENT: Parsed text storage
-- ============================================================================

CREATE TABLE "document_contents" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "document_id" TEXT NOT NULL UNIQUE,
  "full_text" TEXT NOT NULL,
  "structured" JSONB,
  "word_count" INTEGER NOT NULL DEFAULT 0,
  "parsed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "document_contents_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "documents"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- ============================================================================
-- DOCUMENT-INSTRUMENT LINKING: Many-to-many
-- ============================================================================

CREATE TABLE "document_instruments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "document_id" TEXT NOT NULL,
  "instrument_id" TEXT NOT NULL,
  "relevance" DECIMAL(65,30) NOT NULL DEFAULT 1.0,
  "match_method" TEXT NOT NULL,

  CONSTRAINT "document_instruments_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "documents"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "document_instruments_instrument_id_fkey"
    FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE ("document_id", "instrument_id")
);

CREATE INDEX "document_instruments_instrument_id_idx" ON "document_instruments"("instrument_id");

-- ============================================================================
-- DOCUMENT FACTS: Extracted facts from documents
-- ============================================================================

CREATE TABLE "document_facts" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "document_id" TEXT NOT NULL,
  "fact_type" "FactType" NOT NULL,
  "data" JSONB NOT NULL,
  "evidence" TEXT,
  "confidence" DECIMAL(65,30) DEFAULT 1.0,
  "extracted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "document_facts_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "documents"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "document_facts_document_id_idx" ON "document_facts"("document_id");
CREATE INDEX "document_facts_fact_type_idx" ON "document_facts"("fact_type");

-- ============================================================================
-- INSTRUMENT CLASSIFICATION: Industry/sector tagging
-- ============================================================================

CREATE TABLE "instrument_classifications" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "instrument_id" TEXT NOT NULL UNIQUE,
  "industry" "IndustryType" NOT NULL,
  "sector" "SectorType" NOT NULL,
  "confidence" DECIMAL(65,30) NOT NULL DEFAULT 1.0,
  "rationale" TEXT,
  "classified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "instrument_classifications_instrument_id_fkey"
    FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "instrument_classifications_industry_idx" ON "instrument_classifications"("industry");
CREATE INDEX "instrument_classifications_sector_idx" ON "instrument_classifications"("sector");

-- ============================================================================
-- COMPETITOR RELATIONSHIPS: Peer company mapping
-- ============================================================================

CREATE TABLE "competitor_relationships" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "instrument_id" TEXT NOT NULL,
  "competitor_id" TEXT NOT NULL,
  "relationship_type" TEXT NOT NULL,
  "confidence" DECIMAL(65,30) NOT NULL DEFAULT 0.7,
  "rationale" TEXT,
  "discovered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "competitor_relationships_instrument_id_fkey"
    FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "competitor_relationships_competitor_id_fkey"
    FOREIGN KEY ("competitor_id") REFERENCES "instruments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE ("instrument_id", "competitor_id")
);

CREATE INDEX "competitor_relationships_instrument_id_idx" ON "competitor_relationships"("instrument_id");
CREATE INDEX "competitor_relationships_competitor_id_idx" ON "competitor_relationships"("competitor_id");

-- ============================================================================
-- FACTOR EXPOSURES: Commodity/macro factor linkage
-- ============================================================================

CREATE TABLE "factor_exposures" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "instrument_id" TEXT NOT NULL,
  "factor_type" "FactorType" NOT NULL,
  "direction" TEXT NOT NULL,
  "magnitude" DECIMAL(65,30) NOT NULL,
  "confidence" DECIMAL(65,30) NOT NULL DEFAULT 0.7,
  "rationale" TEXT,
  "discovered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "factor_exposures_instrument_id_fkey"
    FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE ("instrument_id", "factor_type")
);

CREATE INDEX "factor_exposures_factor_type_idx" ON "factor_exposures"("factor_type");

-- ============================================================================
-- SYNC WATERMARKS: Unified sync tracking for all sources
-- ============================================================================

CREATE TABLE "sync_watermarks" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "source_type" TEXT NOT NULL,
  "source_key" TEXT NOT NULL,
  "last_synced_at" TIMESTAMP(3) NOT NULL,
  "last_item_date" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE ("source_type", "source_key")
);

CREATE INDEX "sync_watermarks_last_item_date_idx" ON "sync_watermarks"("last_item_date");
