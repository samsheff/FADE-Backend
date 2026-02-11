-- Enable trigram support for market text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram indexes to power case-insensitive partial matches
CREATE INDEX IF NOT EXISTS markets_question_trgm_idx ON markets USING gin (question gin_trgm_ops);
CREATE INDEX IF NOT EXISTS markets_marketSlug_trgm_idx ON markets USING gin (marketSlug gin_trgm_ops);
CREATE INDEX IF NOT EXISTS markets_categoryTag_trgm_idx ON markets USING gin (categoryTag gin_trgm_ops);
