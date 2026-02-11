import { getLogger } from '../../utils/logger.js';
import type { Logger } from 'pino';
import { InstrumentRepository } from '../../adapters/database/repositories/instrument.repository.js';
import { FilingRepository } from '../../adapters/database/repositories/filing.repository.js';
import type {
  IndustryType,
  SectorType,
} from '../../types/document.types.js';
import { FilingStatus } from '../../types/edgar.types.js';

/**
 * Keyword mapping for industry classification
 */
const INDUSTRY_KEYWORDS: Record<IndustryType, string[]> = {
  PHARMACEUTICAL: [
    'pharmaceutical',
    'drug',
    'medicine',
    'therapy',
    'fda approval',
    'clinical trial',
    'prescription',
    'generic drug',
    'patent medicine',
  ],
  BIOTECHNOLOGY: [
    'biotechnology',
    'biotech',
    'biopharmaceutical',
    'gene therapy',
    'genetic',
    'genomic',
    'crispr',
    'protein',
    'antibody',
    'biologics',
  ],
  MINING: [
    'mining',
    'gold',
    'silver',
    'copper',
    'mineral',
    'ore',
    'coal',
    'lithium',
    'nickel',
    'zinc',
    'exploration',
    'extraction',
  ],
  ENERGY: [
    'oil',
    'gas',
    'petroleum',
    'energy',
    'renewable',
    'drilling',
    'upstream',
    'downstream',
    'refining',
    'lng',
    'natural gas',
  ],
  FINANCE: [
    'bank',
    'financial',
    'lending',
    'credit',
    'mortgage',
    'insurance',
    'asset management',
    'investment',
    'hedge fund',
    'private equity',
  ],
  TECHNOLOGY: [
    'software',
    'technology',
    'cloud',
    'saas',
    'artificial intelligence',
    'machine learning',
    'semiconductor',
    'chip',
    'computing',
    'data center',
    // Telecommunications/networking infrastructure (maps to COMMUNICATION_SERVICES sector)
    'telecom',
    'wireless',
    'broadband',
    'network',
    'carrier',
    '5g',
    'spectrum',
    'fiber',
    'cable',
  ],
  HEALTHCARE: [
    'hospital',
    'healthcare',
    'medical device',
    'diagnostic',
    'imaging',
    'surgical',
    'patient care',
    'clinic',
    'healthcare services',
  ],
  REAL_ESTATE: [
    'real estate',
    'reit',
    'property',
    'commercial real estate',
    'residential',
    'landlord',
    'lease',
    'development',
    'construction',
  ],
  CONSUMER: [
    'retail',
    'consumer',
    'e-commerce',
    'brand',
    'merchandise',
    'apparel',
    'food',
    'beverage',
    'restaurant',
    'grocery',
  ],
  INDUSTRIAL: [
    'manufacturing',
    'industrial',
    'machinery',
    'equipment',
    'aerospace',
    'defense',
    'automotive',
    'transportation',
    'logistics',
  ],
  UTILITIES: [
    'utility',
    'electric',
    'power',
    'water',
    'grid',
    'transmission',
    'distribution',
    'renewable energy',
    'solar',
    'wind',
  ],
  OTHER: [],
};

/**
 * Industry to GICS sector mapping
 * Maps to Prisma SectorType enum - must match schema exactly
 */
const INDUSTRY_TO_SECTOR: Record<IndustryType, SectorType> = {
  PHARMACEUTICAL: 'HEALTHCARE',
  BIOTECHNOLOGY: 'HEALTHCARE',
  HEALTHCARE: 'HEALTHCARE',
  MINING: 'MATERIALS',
  ENERGY: 'ENERGY',
  FINANCE: 'FINANCIALS',
  TECHNOLOGY: 'TECHNOLOGY',
  REAL_ESTATE: 'REAL_ESTATE',
  CONSUMER: 'CONSUMER_DISCRETIONARY',
  INDUSTRIAL: 'INDUSTRIALS',
  UTILITIES: 'UTILITIES',
  OTHER: 'COMMUNICATION_SERVICES',
};

export interface Classification {
  instrumentId: string;
  industry: IndustryType;
  sector: SectorType;
  confidence: number;
  rationale: string;
}

/**
 * Service for classifying instruments into industries and sectors
 */
export class EntityClassificationService {
  private logger: Logger;
  private instrumentRepo: InstrumentRepository;
  private filingRepo: FilingRepository;

  constructor() {
    this.logger = getLogger().child({ service: 'EntityClassificationService' });
    this.instrumentRepo = new InstrumentRepository();
    this.filingRepo = new FilingRepository();
  }

  /**
   * Classify a single instrument
   */
  async classifyInstrument(instrumentId: string): Promise<Classification | null> {
    try {
      // Fetch instrument
      const instrument = await this.instrumentRepo.findById(instrumentId);
      if (!instrument) {
        this.logger.warn({ instrumentId }, 'Instrument not found');
        return null;
      }

      // Build base corpus from name and ticker
      let corpus = `${instrument.name} ${instrument.ticker}`.toLowerCase();

      // Optionally enhance with filing content
      if (instrument.cik) {
        try {
          const filings = await this.filingRepo.findByCik(instrument.cik, {
            status: FilingStatus.ENRICHED,
            limit: 1,
          });

          if (filings.length > 0) {
            const content = await this.filingRepo.findContentByFilingId(
              filings[0].id
            );
            if (content?.fullText) {
              // Extract first 2000 words from business description
              const words = content.fullText.split(/\s+/).slice(0, 2000);
              corpus += ' ' + words.join(' ').toLowerCase();
            }
          }
        } catch (error) {
          this.logger.debug(
            { error, cik: instrument.cik },
            'Could not fetch filing content for classification'
          );
          // Continue with basic corpus
        }
      }

      // Score each industry
      const scores = new Map<IndustryType, number>();
      const matchedKeywords = new Map<IndustryType, string[]>();

      for (const [industry, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
        if (keywords.length === 0) continue; // Skip OTHER

        const matches: string[] = [];
        for (const keyword of keywords) {
          if (corpus.includes(keyword.toLowerCase())) {
            matches.push(keyword);
          }
        }

        if (matches.length > 0) {
          // Calculate confidence: base 0.4 + 0.1 per match, max 1.0
          const confidence = Math.min(0.4 + matches.length * 0.1, 1.0);
          scores.set(industry as IndustryType, confidence);
          matchedKeywords.set(industry as IndustryType, matches);
        }
      }

      // Select highest-scoring industry
      let bestIndustry: IndustryType = 'OTHER';
      let bestScore = 0;

      for (const [industry, score] of scores.entries()) {
        if (score > bestScore) {
          bestScore = score;
          bestIndustry = industry;
        }
      }

      // Map to sector
      const sector = INDUSTRY_TO_SECTOR[bestIndustry];

      // Build rationale
      let rationale: string;
      if (bestIndustry === 'OTHER') {
        rationale = 'No specific industry keywords matched. Classified as OTHER.';
      } else {
        const keywords = matchedKeywords.get(bestIndustry) || [];
        rationale = `Matched ${keywords.length} keyword(s): ${keywords.slice(0, 5).join(', ')}${
          keywords.length > 5 ? '...' : ''
        }`;
      }

      this.logger.info(
        {
          instrumentId,
          ticker: instrument.ticker,
          industry: bestIndustry,
          sector,
          confidence: bestScore,
        },
        'Classified instrument'
      );

      return {
        instrumentId,
        industry: bestIndustry,
        sector,
        confidence: bestScore,
        rationale,
      };
    } catch (error) {
      this.logger.error({ error, instrumentId }, 'Failed to classify instrument');
      throw error;
    }
  }

  /**
   * Classify multiple instruments in batch
   */
  async classifyBatch(instrumentIds: string[]): Promise<Classification[]> {
    const classifications: Classification[] = [];

    for (const id of instrumentIds) {
      try {
        const classification = await this.classifyInstrument(id);
        if (classification) {
          classifications.push(classification);
        }
      } catch (error) {
        this.logger.error({ error, instrumentId: id }, 'Failed in batch classification');
        // Continue with remaining instruments
      }
    }

    return classifications;
  }
}
