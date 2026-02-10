import { getLogger } from '../../utils/logger.js';
import type { Logger } from 'pino';
import { InstrumentRepository } from '../../adapters/database/repositories/instrument.repository.js';
import { FilingRepository } from '../../adapters/database/repositories/filing.repository.js';
import type {
  IndustryType,
  FactorType,
} from '../../types/document.types.js';

interface FactorConfig {
  factorType: FactorType;
  direction: 'POSITIVE' | 'NEGATIVE';
  baseMagnitude: number;
  keywords: string[];
}

/**
 * Static industry to factor exposure mappings
 */
const INDUSTRY_FACTOR_MAPPINGS: Record<IndustryType, FactorConfig[]> = {
  MINING: [
    {
      factorType: 'COMMODITY_GOLD',
      direction: 'POSITIVE',
      baseMagnitude: 0.7,
      keywords: ['gold', 'gold mine', 'gold production', 'gold exploration'],
    },
    {
      factorType: 'COMMODITY_SILVER',
      direction: 'POSITIVE',
      baseMagnitude: 0.6,
      keywords: ['silver', 'silver mine', 'silver production'],
    },
    {
      factorType: 'COMMODITY_COPPER',
      direction: 'POSITIVE',
      baseMagnitude: 0.6,
      keywords: ['copper', 'copper mine', 'copper production'],
    },
  ],
  ENERGY: [
    {
      factorType: 'COMMODITY_OIL',
      direction: 'POSITIVE',
      baseMagnitude: 0.8,
      keywords: ['oil', 'crude', 'petroleum', 'upstream', 'drilling'],
    },
    {
      factorType: 'COMMODITY_NATURAL_GAS',
      direction: 'POSITIVE',
      baseMagnitude: 0.7,
      keywords: ['natural gas', 'lng', 'gas production', 'gas pipeline'],
    },
  ],
  FINANCE: [
    {
      factorType: 'INTEREST_RATE_FED_FUNDS',
      direction: 'NEGATIVE',
      baseMagnitude: 0.6,
      keywords: ['interest rate', 'fed funds', 'monetary policy', 'lending'],
    },
    {
      factorType: 'INTEREST_RATE_10Y',
      direction: 'NEGATIVE',
      baseMagnitude: 0.5,
      keywords: ['treasury', 'yield curve', 'bond', 'fixed income'],
    },
  ],
  REAL_ESTATE: [
    {
      factorType: 'INTEREST_RATE_FED_FUNDS',
      direction: 'NEGATIVE',
      baseMagnitude: 0.7,
      keywords: ['mortgage', 'financing', 'debt', 'leverage'],
    },
  ],
  UTILITIES: [
    {
      factorType: 'INTEREST_RATE_10Y',
      direction: 'NEGATIVE',
      baseMagnitude: 0.5,
      keywords: ['utility', 'regulated', 'dividend', 'infrastructure'],
    },
  ],
  // Industries with no specific factor exposures (only market beta)
  PHARMACEUTICAL: [],
  BIOTECHNOLOGY: [],
  TECHNOLOGY: [],
  HEALTHCARE: [],
  CONSUMER: [],
  INDUSTRIAL: [],
  OTHER: [],
};

export interface FactorExposure {
  instrumentId: string;
  factorType: FactorType;
  direction: 'POSITIVE' | 'NEGATIVE';
  magnitude: number;
  confidence: number;
  rationale: string;
}

/**
 * Service for mapping instruments to factor exposures
 */
export class FactorMappingService {
  private logger: Logger;
  private instrumentRepo: InstrumentRepository;
  private filingRepo: FilingRepository;

  constructor() {
    this.logger = getLogger().child({ service: 'FactorMappingService' });
    this.instrumentRepo = new InstrumentRepository();
    this.filingRepo = new FilingRepository();
  }

  /**
   * Map factor exposures for a single instrument
   */
  async mapFactorExposures(instrumentId: string): Promise<FactorExposure[]> {
    try {
      const exposures: FactorExposure[] = [];

      // Fetch classification
      const classification = await this.instrumentRepo.getClassification(instrumentId);

      if (!classification) {
        this.logger.warn(
          { instrumentId },
          'No classification found, returning only market beta'
        );

        // Return only market beta
        exposures.push({
          instrumentId,
          factorType: 'INDEX_SPX',
          direction: 'POSITIVE',
          magnitude: 0.5,
          confidence: 0.8,
          rationale: 'Default market beta exposure for all instruments',
        });

        return exposures;
      }

      // Get factor configs for this industry
      const factorConfigs = INDUSTRY_FACTOR_MAPPINGS[classification.industry] || [];

      // Optionally fetch filing content for keyword-based magnitude refinement
      let filingContent: string | null = null;
      const instrument = await this.instrumentRepo.findById(instrumentId);

      if (instrument?.cik) {
        try {
          const filings = await this.filingRepo.findByCik(instrument.cik, {
            status: 'ENRICHED',
            limit: 1,
          });

          if (filings.length > 0) {
            const content = await this.filingRepo.findContentByFilingId(
              filings[0].id
            );
            if (content?.fullText) {
              // Extract first 2000 words
              const words = content.fullText.split(/\s+/).slice(0, 2000);
              filingContent = words.join(' ').toLowerCase();
            }
          }
        } catch (error) {
          this.logger.debug(
            { error, cik: instrument.cik },
            'Could not fetch filing content for factor mapping'
          );
        }
      }

      // Map each factor config to exposure
      for (const config of factorConfigs) {
        let magnitude = config.baseMagnitude;
        let confidence = 0.6; // Static mapping confidence
        const matchedKeywords: string[] = [];

        // Refine magnitude using keyword frequency if filing content available
        if (filingContent) {
          for (const keyword of config.keywords) {
            const regex = new RegExp(keyword.toLowerCase(), 'g');
            const matches = filingContent.match(regex);
            if (matches) {
              matchedKeywords.push(keyword);
            }
          }

          if (matchedKeywords.length > 0) {
            // Boost magnitude: +0.05 per keyword match, max +0.3
            const boost = Math.min(matchedKeywords.length * 0.05, 0.3);
            magnitude = Math.min(config.baseMagnitude + boost, 1.0);
            confidence = 0.8; // Higher confidence with keyword matches
          }
        }

        const rationale =
          matchedKeywords.length > 0
            ? `${config.direction === 'POSITIVE' ? 'Profits when' : 'Hurt by'} ${
                config.factorType
              } increases. Matched keywords: ${matchedKeywords.join(', ')}`
            : `${config.direction === 'POSITIVE' ? 'Profits when' : 'Hurt by'} ${
                config.factorType
              } increases (industry-based static mapping)`;

        exposures.push({
          instrumentId,
          factorType: config.factorType,
          direction: config.direction,
          magnitude,
          confidence,
          rationale,
        });
      }

      // Always add market beta (INDEX_SPX) for all instruments
      exposures.push({
        instrumentId,
        factorType: 'INDEX_SPX',
        direction: 'POSITIVE',
        magnitude: 0.5,
        confidence: 0.8,
        rationale: 'Default market beta exposure for all instruments',
      });

      this.logger.info(
        {
          instrumentId,
          ticker: instrument?.ticker,
          industry: classification.industry,
          exposureCount: exposures.length,
        },
        'Mapped factor exposures'
      );

      return exposures;
    } catch (error) {
      this.logger.error({ error, instrumentId }, 'Failed to map factor exposures');
      throw error;
    }
  }

  /**
   * Map factor exposures for multiple instruments in batch
   * Returns total count of exposures created
   */
  async mapBatch(instrumentIds: string[]): Promise<number> {
    let totalCreated = 0;

    for (const id of instrumentIds) {
      try {
        const exposures = await this.mapFactorExposures(id);

        // Persist exposures
        for (const exposure of exposures) {
          try {
            await this.instrumentRepo.upsertFactorExposure(exposure);
            totalCreated++;
          } catch (error: any) {
            this.logger.error(
              { error, instrumentId: id, factorType: exposure.factorType },
              'Failed to upsert factor exposure'
            );
            // Continue with remaining exposures
          }
        }
      } catch (error) {
        this.logger.error(
          { error, instrumentId: id },
          'Failed in batch factor mapping'
        );
        // Continue with remaining instruments
      }
    }

    return totalCreated;
  }
}
