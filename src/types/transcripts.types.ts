/**
 * Transcripts Worker Type Definitions
 *
 * Types for earnings call transcript ingestion, parsing, and signal extraction.
 */

/**
 * Section within an earnings call transcript
 */
export type TranscriptSection = 'PREPARED_REMARKS' | 'QA_SESSION' | 'OPERATOR_INTRO';

/**
 * Text snippet with context from transcript
 */
export interface TranscriptSnippet {
  /** Context window around matched keyword (100-150 chars) */
  text: string;

  /** Speaker identifier (e.g., "CEO - John Smith", "CFO", "Analyst - Morgan Stanley") */
  speaker: string;

  /** Section of transcript where snippet appears */
  section: TranscriptSection;

  /** Character offset in full transcript (for retrieval) */
  offset: number;

  /** Keywords that matched in this snippet */
  keywords: string[];
}

/**
 * Structured evidence for transcript-derived signals
 * Stored in InstrumentSignal.evidenceFacts JSON field
 */
export interface TranscriptEvidence {
  /** Document ID (foreign key to Document table) */
  documentId: string;

  /** Stock ticker symbol */
  symbol: string;

  /** Fiscal quarter (e.g., "Q2 2024") */
  fiscalQuarter: string;

  /** Earnings call date (ISO 8601) */
  callDate: string;

  /** Context excerpts with keyword matches (1-3 snippets) */
  snippets: TranscriptSnippet[];

  /** Optional quantitative extractions */
  quantitative?: {
    /** Cash runway in months (extracted from "X months of cash" patterns) */
    runwayMonths?: number;

    /** Percentage change (e.g., margin compression, guidance cut) */
    percentageChange?: number;

    /** Headcount reduction (extracted from layoff announcements) */
    headcountReduction?: number;

    /** Dollar amount (e.g., settlement, capital raise) */
    dollarAmount?: string;
  };

  /** Confidence score (0-1, derived from signal score) */
  confidence: number;

  /** Keyword density (matches per 1000 words) */
  keywordDensity: number;
}

/**
 * Parsed transcript structure
 * Stored in DocumentContent.structured JSON field
 */
export interface ParsedTranscript {
  /** Transcript sections with text and word counts */
  sections: {
    preparedRemarks: {
      text: string;
      wordCount: number;
    };
    qaSession: {
      text: string;
      wordCount: number;
    };
  };

  /** Speaker map: name -> normalized title (e.g., "John Smith" -> "CEO") */
  speakers: Record<string, string>;

  /** Aggregate metadata */
  metadata: {
    /** Total word count across all sections */
    totalWordCount: number;

    /** Ratio of Q&A to total transcript (0-1) */
    qaRatio: number;
  };
}

/**
 * FMP API response for transcript list
 */
export interface FmpTranscriptListResponse {
  symbol: string;
  quarter: number;
  year: number;
  date: string;
}

/**
 * FMP API response for full transcript
 */
export interface FmpTranscriptResponse {
  symbol: string;
  quarter: number;
  year: number;
  date: string;
  content: string;
}

/**
 * Signal detection keyword pattern
 */
export interface KeywordPattern {
  /** Keywords to search for (case-insensitive) */
  keywords: string[];

  /** Negative keywords (if present, exclude the match) */
  negations?: string[];

  /** Context window size in words (for snippet extraction) */
  contextWords?: number;

  /** Minimum keyword density (matches per 1000 words) to trigger signal */
  minDensity?: number;
}

/**
 * Signal detector configuration
 */
export interface SignalDetectorConfig {
  /** Signal type from Prisma schema */
  signalType: string;

  /** Keyword pattern for detection */
  pattern: KeywordPattern;

  /** Base severity (can be escalated by context rules) */
  baseSeverity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

  /** Minimum confidence threshold (0-1) */
  minConfidence: number;

  /** Optional quantitative extraction rules */
  extraction?: {
    /** Regex pattern for extraction (e.g., /(\d+)\s+months of cash/i) */
    pattern: RegExp;

    /** Named capture group or extraction logic */
    field: string;
  };
}
