import { getLogger } from '../utils/logger.js';
import { getEnvironment } from '../config/environment.js';
import type { Logger } from 'pino';
import {
  EntityClassificationService,
  CompetitorDiscoveryService,
  FactorMappingService,
} from '../services/entity/index.js';
import { InstrumentRepository } from '../adapters/database/repositories/instrument.repository.js';

interface EnrichmentStats {
  totalInstruments: number;
  classified: number;
  competitorRelationshipsCreated: number;
  factorExposuresCreated: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
}

/**
 * Background job for enriching instruments with classifications, competitors, and factor exposures
 */
export class EntityEnrichmentJob {
  private logger: Logger;
  private classificationService: EntityClassificationService;
  private competitorService: CompetitorDiscoveryService;
  private factorService: FactorMappingService;
  private instrumentRepo: InstrumentRepository;
  private intervalId: NodeJS.Timeout | null = null;
  private hasRunBackfill = false;
  private isRunning = false;

  constructor() {
    this.logger = getLogger().child({ job: 'EntityEnrichmentJob' });
    this.classificationService = new EntityClassificationService();
    this.competitorService = new CompetitorDiscoveryService();
    this.factorService = new FactorMappingService();
    this.instrumentRepo = new InstrumentRepository();
  }

  /**
   * Start the job with backfill and scheduled runs
   */
  async start(): Promise<void> {
    const env = getEnvironment();

    if (!env.ENTITY_ENRICHMENT_ENABLED) {
      this.logger.info('Entity enrichment job is disabled');
      return;
    }

    this.logger.info('Starting entity enrichment job');

    // Run one-time backfill if not done
    if (!this.hasRunBackfill) {
      await this.runBackfill();
      this.hasRunBackfill = true;
    }

    // Initial run for stale classifications
    await this.run();

    // Schedule weekly runs
    this.intervalId = setInterval(() => {
      this.run().catch((error) => {
        this.logger.error({ err: error }, 'Scheduled entity enrichment run failed');
      });
    }, env.ENTITY_ENRICHMENT_INTERVAL_MS);

    this.logger.info(
      { intervalMs: env.ENTITY_ENRICHMENT_INTERVAL_MS },
      'Entity enrichment job scheduled'
    );
  }

  /**
   * Stop the job and clear scheduled runs
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.info('Entity enrichment job stopped');
    }
  }

  /**
   * Run backfill for all unclassified instruments
   */
  private async runBackfill(): Promise<EnrichmentStats> {
    this.logger.info('Starting entity enrichment backfill');

    const stats: EnrichmentStats = {
      totalInstruments: 0,
      classified: 0,
      competitorRelationshipsCreated: 0,
      factorExposuresCreated: 0,
      errors: 0,
      startTime: new Date(),
    };

    try {
      const env = getEnvironment();
      const batchSize = env.ENTITY_ENRICHMENT_BATCH_SIZE;

      // Get all unclassified active instruments
      const unclassifiedInstruments = await this.instrumentRepo.findUnclassified({
        isActive: true,
      });

      stats.totalInstruments = unclassifiedInstruments.length;

      this.logger.info(
        { totalInstruments: stats.totalInstruments },
        'Found unclassified instruments'
      );

      // Process in batches
      for (let i = 0; i < unclassifiedInstruments.length; i += batchSize) {
        const batch = unclassifiedInstruments.slice(i, i + batchSize);
        const batchIds = batch.map((inst) => inst.id);

        this.logger.info(
          { batchNumber: Math.floor(i / batchSize) + 1, batchSize: batch.length },
          'Processing backfill batch'
        );

        const batchStats = await this.processInstrumentBatch(batchIds);

        // Aggregate stats
        stats.classified += batchStats.classified;
        stats.competitorRelationshipsCreated +=
          batchStats.competitorRelationshipsCreated;
        stats.factorExposuresCreated += batchStats.factorExposuresCreated;
        stats.errors += batchStats.errors;

        // Log progress
        this.logger.info(
          {
            progress: `${i + batch.length}/${stats.totalInstruments}`,
            classified: stats.classified,
            errors: stats.errors,
          },
          'Backfill progress'
        );
      }

      stats.endTime = new Date();

      this.logger.info({ stats }, 'Entity enrichment backfill complete');

      return stats;
    } catch (error) {
      this.logger.error({ err: error }, 'Backfill failed');
      throw error;
    }
  }

  /**
   * Run regular enrichment for stale classifications
   */
  async run(): Promise<EnrichmentStats> {
    if (this.isRunning) {
      this.logger.warn('Entity enrichment job already running, skipping');
      return {
        totalInstruments: 0,
        classified: 0,
        competitorRelationshipsCreated: 0,
        factorExposuresCreated: 0,
        errors: 0,
        startTime: new Date(),
      };
    }

    this.isRunning = true;

    const stats: EnrichmentStats = {
      totalInstruments: 0,
      classified: 0,
      competitorRelationshipsCreated: 0,
      factorExposuresCreated: 0,
      errors: 0,
      startTime: new Date(),
    };

    try {
      const env = getEnvironment();
      const batchSize = env.ENTITY_ENRICHMENT_BATCH_SIZE;

      // Find instruments needing enrichment:
      // 1. No classification
      // 2. Classification older than 30 days
      const staleDate = new Date();
      staleDate.setDate(staleDate.getDate() - 30);

      const instrumentsToEnrich = await this.instrumentRepo.findStaleClassifications({
        isActive: true,
        staleDate,
        limit: batchSize,
      });

      stats.totalInstruments = instrumentsToEnrich.length;

      if (stats.totalInstruments === 0) {
        this.logger.info('No instruments need enrichment');
        this.isRunning = false;
        return stats;
      }

      this.logger.info(
        { totalInstruments: stats.totalInstruments },
        'Starting entity enrichment run'
      );

      const batchIds = instrumentsToEnrich.map((inst) => inst.id);
      const batchStats = await this.processInstrumentBatch(batchIds);

      // Aggregate stats
      stats.classified = batchStats.classified;
      stats.competitorRelationshipsCreated =
        batchStats.competitorRelationshipsCreated;
      stats.factorExposuresCreated = batchStats.factorExposuresCreated;
      stats.errors = batchStats.errors;
      stats.endTime = new Date();

      this.logger.info({ stats }, 'Entity enrichment run complete');

      return stats;
    } catch (error) {
      this.logger.error({ err: error }, 'Entity enrichment run failed');
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Process a batch of instruments through the full enrichment pipeline
   */
  private async processInstrumentBatch(
    instrumentIds: string[]
  ): Promise<Omit<EnrichmentStats, 'totalInstruments' | 'startTime'>> {
    const stats = {
      classified: 0,
      competitorRelationshipsCreated: 0,
      factorExposuresCreated: 0,
      errors: 0,
    };

    for (const instrumentId of instrumentIds) {
      try {
        // Stage 1: Classify instrument
        const classification =
          await this.classificationService.classifyInstrument(instrumentId);

        if (classification) {
          // Individual upsert failures should not crash entire batch
          try {
            await this.instrumentRepo.upsertClassification(classification);
            stats.classified++;
          } catch (upsertError) {
            this.logger.error(
              { err: upsertError, instrumentId, classification },
              'Failed to upsert classification'
            );
            stats.errors++;
            // Continue to next instrument
            continue;
          }

          // Stage 2: Discover competitors
          try {
            const competitors =
              await this.competitorService.discoverCompetitors(instrumentId);

            for (const competitor of competitors) {
              try {
                await this.instrumentRepo.createCompetitorRelationship(competitor);
                stats.competitorRelationshipsCreated++;
              } catch (error: any) {
                // Ignore duplicate key errors (expected due to bidirectional creation)
                if (error?.code === '23505' || error?.code === 'P2002') {
                  continue;
                }
                throw error;
              }
            }
          } catch (error) {
            this.logger.error(
              { err: error, instrumentId },
              'Failed to discover competitors'
            );
            stats.errors++;
            // Continue to factor mapping
          }

          // Stage 3: Map factor exposures
          try {
            const exposures =
              await this.factorService.mapFactorExposures(instrumentId);

            for (const exposure of exposures) {
              await this.instrumentRepo.upsertFactorExposure(exposure);
              stats.factorExposuresCreated++;
            }
          } catch (error) {
            this.logger.error(
              { err: error, instrumentId },
              'Failed to map factor exposures'
            );
            stats.errors++;
          }
        } else {
          this.logger.warn({ instrumentId }, 'Failed to classify instrument');
          stats.errors++;
        }
      } catch (error) {
        this.logger.error({ err: error, instrumentId }, 'Failed to enrich instrument');
        stats.errors++;
        // Continue to next instrument
      }
    }

    return stats;
  }

  /**
   * Get job status
   */
  getStatus(): {
    running: boolean;
    hasScheduledRuns: boolean;
    hasRunBackfill: boolean;
  } {
    return {
      running: this.isRunning,
      hasScheduledRuns: this.intervalId !== null,
      hasRunBackfill: this.hasRunBackfill,
    };
  }

  /**
   * Manually trigger a single run (for testing)
   */
  async runOnce(): Promise<EnrichmentStats> {
    return this.run();
  }
}
