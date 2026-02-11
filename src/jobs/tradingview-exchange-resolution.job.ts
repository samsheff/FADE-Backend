/**
 * TradingView Exchange Resolution Batch Job
 *
 * Processes instruments without resolved TradingView symbols in batches.
 * Rate-limited to avoid overwhelming the TradingView API.
 */

import { InstrumentRepository } from '../adapters/database/repositories/instrument.repository.js';
import { TradingViewExchangeResolverService } from '../services/market-data/tradingview-exchange-resolver.service.js';
import { getLogger } from '../utils/logger.js';
import { getPrismaClient } from '../adapters/database/client.js';

export interface ResolutionJobResult {
  processed: number;
  resolved: number;
  failed: number;
  skipped: number;
}

export class TradingViewExchangeResolutionJob {
  private instrumentRepo: InstrumentRepository;
  private resolver: TradingViewExchangeResolverService;
  private prisma;
  private logger;

  // Rate limiting: 5 resolutions per minute (conservative for TradingView)
  private static readonly BATCH_SIZE = 5;
  private static readonly BATCH_DELAY_MS = 60_000; // 1 minute between batches

  constructor() {
    this.instrumentRepo = new InstrumentRepository();
    this.resolver = new TradingViewExchangeResolverService();
    this.prisma = getPrismaClient();
    this.logger = getLogger();
  }

  /**
   * Run a single batch of resolutions
   *
   * @param batchSize - Number of instruments to process (default: 5)
   * @returns Statistics about the batch run
   */
  async runBatch(batchSize?: number): Promise<ResolutionJobResult> {
    const size = batchSize || TradingViewExchangeResolutionJob.BATCH_SIZE;

    this.logger.info({ batchSize: size }, 'Starting TradingView exchange resolution batch');

    // Find instruments that need resolution
    const instruments = await this.prisma.instrument.findMany({
      where: {
        tvSymbol: null,
        isActive: true,
      },
      take: size,
      orderBy: {
        createdAt: 'asc', // Process oldest first
      },
    });

    if (instruments.length === 0) {
      this.logger.info('No instruments need resolution');
      return {
        processed: 0,
        resolved: 0,
        failed: 0,
        skipped: 0,
      };
    }

    this.logger.info(
      { count: instruments.length, batchSize: size },
      'Found instruments needing resolution',
    );

    let resolved = 0;
    let failed = 0;
    let skipped = 0;

    // Process each instrument
    for (const instrument of instruments) {
      try {
        this.logger.debug(
          { instrumentId: instrument.id, symbol: instrument.symbol },
          'Attempting to resolve symbol',
        );

        // Attempt resolution
        const resolution = await this.resolver.resolveSymbol(
          instrument.symbol,
          instrument.type,
        );

        if (!resolution) {
          this.logger.warn(
            { instrumentId: instrument.id, symbol: instrument.symbol },
            'Failed to resolve TradingView symbol',
          );
          failed++;
          continue;
        }

        // Check confidence threshold
        if (resolution.confidence < 0.7) {
          this.logger.warn(
            {
              instrumentId: instrument.id,
              symbol: instrument.symbol,
              confidence: resolution.confidence,
            },
            'Resolution confidence too low, skipping',
          );
          skipped++;
          continue;
        }

        // Update database with resolved symbol
        await this.instrumentRepo.updateTvSymbol(
          instrument.id,
          resolution.tvSymbol,
          resolution.exchange,
        );

        this.logger.info(
          {
            instrumentId: instrument.id,
            symbol: instrument.symbol,
            tvSymbol: resolution.tvSymbol,
            exchange: resolution.exchange,
            confidence: resolution.confidence,
          },
          'Successfully resolved TradingView symbol',
        );

        resolved++;
      } catch (error) {
        this.logger.error(
          { error, instrumentId: instrument.id, symbol: instrument.symbol },
          'Error resolving symbol',
        );
        failed++;
      }
    }

    const result = {
      processed: instruments.length,
      resolved,
      failed,
      skipped,
    };

    this.logger.info(result, 'Batch resolution completed');

    return result;
  }

  /**
   * Run multiple batches until all instruments are processed or max batches reached
   *
   * @param maxBatches - Maximum number of batches to run (default: 10)
   * @returns Cumulative statistics
   */
  async runContinuous(maxBatches = 10): Promise<ResolutionJobResult> {
    this.logger.info({ maxBatches }, 'Starting continuous resolution job');

    const cumulative: ResolutionJobResult = {
      processed: 0,
      resolved: 0,
      failed: 0,
      skipped: 0,
    };

    for (let i = 0; i < maxBatches; i++) {
      const batchResult = await this.runBatch();

      // Accumulate results
      cumulative.processed += batchResult.processed;
      cumulative.resolved += batchResult.resolved;
      cumulative.failed += batchResult.failed;
      cumulative.skipped += batchResult.skipped;

      // If no instruments were processed, we're done
      if (batchResult.processed === 0) {
        this.logger.info('All instruments resolved, stopping continuous job');
        break;
      }

      // Wait before next batch (unless this is the last batch)
      if (i < maxBatches - 1 && batchResult.processed > 0) {
        this.logger.debug(
          { delayMs: TradingViewExchangeResolutionJob.BATCH_DELAY_MS },
          'Waiting before next batch',
        );
        await this.sleep(TradingViewExchangeResolutionJob.BATCH_DELAY_MS);
      }
    }

    this.logger.info(cumulative, 'Continuous resolution job completed');

    return cumulative;
  }

  /**
   * Get count of instruments needing resolution
   */
  async getPendingCount(): Promise<number> {
    return this.prisma.instrument.count({
      where: {
        tvSymbol: null,
        isActive: true,
      },
    });
  }

  /**
   * Get statistics on resolution status
   */
  async getResolutionStats(): Promise<{
    total: number;
    resolved: number;
    pending: number;
    resolutionRate: number;
  }> {
    const [total, resolved] = await Promise.all([
      this.prisma.instrument.count({
        where: { isActive: true },
      }),
      this.prisma.instrument.count({
        where: {
          isActive: true,
          tvSymbol: { not: null },
        },
      }),
    ]);

    const pending = total - resolved;
    const resolutionRate = total > 0 ? resolved / total : 0;

    return {
      total,
      resolved,
      pending,
      resolutionRate,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
