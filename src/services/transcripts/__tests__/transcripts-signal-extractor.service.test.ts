import { describe, it, expect, beforeEach } from '@jest/globals';
import { TranscriptsSignalExtractorService } from '../transcripts-signal-extractor.service';

describe('TranscriptsSignalExtractorService', () => {
  let service: TranscriptsSignalExtractorService;

  beforeEach(() => {
    service = new TranscriptsSignalExtractorService();
  });

  describe('detectLiquidityStress', () => {
    it('should detect liquidity stress with runway mention', () => {
      const content = `
        We have approximately 8 months of cash runway at our current burn rate.
        We're actively monitoring our liquidity position and exploring options.
      `;

      const structured = {
        sections: {
          preparedRemarks: { text: content, wordCount: 100 },
          qaSession: { text: '', wordCount: 0 },
        },
        speakers: {},
        metadata: { totalWordCount: 100, qaRatio: 0 },
      };

      const metadata = { symbol: 'TEST', fiscalQuarter: 'Q2 2024' };
      const document = {
        id: 'doc1',
        publishedAt: new Date(),
      } as any;

      const signal = service['detectLiquidityStress'](content, structured, metadata, document);

      expect(signal).not.toBeNull();
      expect(signal?.severity).toBe('HIGH');
      expect(signal?.evidence.quantitative?.runwayMonths).toBe(8);
    });

    it('should exclude positive liquidity statements', () => {
      const content = 'Our liquidity position is strong with adequate cash on hand.';

      const structured = {
        sections: {
          preparedRemarks: { text: content, wordCount: 50 },
          qaSession: { text: '', wordCount: 0 },
        },
        speakers: {},
        metadata: { totalWordCount: 50, qaRatio: 0 },
      };

      const signal = service['detectLiquidityStress'](content, structured, {} as any, {} as any);

      expect(signal).toBeNull(); // Negation filter
    });

    it('should return null below confidence threshold', () => {
      const content = 'Single mention of cash.';

      const structured = {
        sections: {
          preparedRemarks: { text: content, wordCount: 1000 },
          qaSession: { text: '', wordCount: 0 },
        },
        speakers: {},
        metadata: { totalWordCount: 1000, qaRatio: 0 },
      };

      const signal = service['detectLiquidityStress'](content, structured, {} as any, {} as any);

      expect(signal).toBeNull(); // Below minimum density
    });
  });

  describe('detectCapitalRaiseImminent', () => {
    it('should detect ATM program activation', () => {
      const content = `
        We have activated our ATM program and intend to utilize our $50 million
        shelf registration in the near term to raise capital.
      `;

      const structured = {
        sections: {
          preparedRemarks: { text: content, wordCount: 100 },
          qaSession: { text: '', wordCount: 0 },
        },
        speakers: {},
        metadata: { totalWordCount: 100, qaRatio: 0 },
      };

      const signal = service['detectCapitalRaiseImminent'](content, structured, {} as any, {} as any);

      expect(signal).not.toBeNull();
      expect(signal?.severity).toBe('CRITICAL');
      expect(signal?.evidence.quantitative?.dollarAmount).toBe('$50M');
    });
  });

  describe('keyword matching utilities', () => {
    it('should find keyword matches', () => {
      const content = 'Cash runway is limited. Working capital is tight.';
      const keywords = ['cash runway', 'working capital'];
      const negations: string[] = [];

      const matches = service['findKeywordMatches'](content, keywords, negations);

      expect(matches).toHaveLength(2);
      expect(matches[0].keyword).toBe('cash runway');
      expect(matches[1].keyword).toBe('working capital');
    });

    it('should filter out negations', () => {
      const content = 'Cash runway is adequate and sufficient for operations.';
      const keywords = ['cash runway'];
      const negations = ['adequate', 'sufficient'];

      const matches = service['findKeywordMatches'](content, keywords, negations);

      expect(matches).toHaveLength(0); // Filtered by negation
    });

    it('should calculate keyword density', () => {
      const matches = 5;
      const wordCount = 1000;

      const density = service['calculateKeywordDensity'](matches, wordCount);

      expect(density).toBe(5.0); // 5 matches per 1000 words
    });
  });
});
