import { getLogger } from '../../utils/logger.js';
import type { Logger } from 'pino';
import { InstrumentRepository } from '../../adapters/database/repositories/instrument.repository.js';

export interface CompetitorRelationship {
  instrumentId: string;
  competitorId: string;
  relationshipType: 'SAME_INDUSTRY' | 'SAME_SECTOR';
  confidence: number;
  rationale: string;
}

/**
 * Service for discovering competitor relationships between instruments
 */
export class CompetitorDiscoveryService {
  private logger: Logger;
  private instrumentRepo: InstrumentRepository;

  constructor() {
    this.logger = getLogger().child({ service: 'CompetitorDiscoveryService' });
    this.instrumentRepo = new InstrumentRepository();
  }

  /**
   * Discover competitors for a single instrument
   * Creates bidirectional relationships (A→B and B→A)
   */
  async discoverCompetitors(instrumentId: string): Promise<CompetitorRelationship[]> {
    try {
      // Fetch instrument classification
      const classification = await this.instrumentRepo.getClassification(instrumentId);

      if (!classification) {
        this.logger.warn(
          { instrumentId },
          'No classification found for instrument, skipping competitor discovery'
        );
        return [];
      }

      // Find all instruments in the same industry
      const sameIndustryInstruments = await this.instrumentRepo.findByIndustry(
        classification.industry,
        500 // Limit to prevent excessive relationships
      );

      // Filter out self and build bidirectional relationships
      const relationships: CompetitorRelationship[] = [];

      for (const competitor of sameIndustryInstruments) {
        if (competitor.id === instrumentId) continue; // Skip self

        // Create A → B relationship
        relationships.push({
          instrumentId: instrumentId,
          competitorId: competitor.id,
          relationshipType: 'SAME_INDUSTRY',
          confidence: 0.7,
          rationale: `Both classified in ${classification.industry} industry`,
        });

        // Create B → A relationship (bidirectional)
        relationships.push({
          instrumentId: competitor.id,
          competitorId: instrumentId,
          relationshipType: 'SAME_INDUSTRY',
          confidence: 0.7,
          rationale: `Both classified in ${classification.industry} industry`,
        });
      }

      this.logger.info(
        {
          instrumentId,
          industry: classification.industry,
          competitorCount: sameIndustryInstruments.length - 1,
          totalRelationships: relationships.length,
        },
        'Discovered competitors'
      );

      return relationships;
    } catch (error) {
      this.logger.error({ error, instrumentId }, 'Failed to discover competitors');
      throw error;
    }
  }

  /**
   * Discover competitors for multiple instruments in batch
   * Returns total count of relationships created
   */
  async discoverBatch(instrumentIds: string[]): Promise<number> {
    let totalCreated = 0;

    for (const id of instrumentIds) {
      try {
        const relationships = await this.discoverCompetitors(id);

        // Persist relationships
        for (const rel of relationships) {
          try {
            await this.instrumentRepo.createCompetitorRelationship(rel);
            totalCreated++;
          } catch (error: any) {
            // Ignore duplicate key errors (expected due to bidirectional creation)
            if (error?.code === '23505' || error?.code === 'P2002') {
              // Postgres unique violation or Prisma unique constraint
              continue;
            }
            throw error;
          }
        }
      } catch (error) {
        this.logger.error(
          { error, instrumentId: id },
          'Failed in batch competitor discovery'
        );
        // Continue with remaining instruments
      }
    }

    return totalCreated;
  }
}
