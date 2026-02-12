import { FmpTranscriptsApiAdapter } from '../../adapters/transcripts/fmp-transcripts-api.adapter.js';
import { DocumentRepository } from '../../adapters/database/repositories/document.repository.js';
import { InstrumentRepository } from '../../adapters/database/repositories/instrument.repository.js';
import { getLogger } from '../../utils/logger.js';
import { CreateDocumentInput, CreateDocumentInstrumentInput } from '../../types/document.types.js';
import { FmpTranscriptListResponse } from '../../types/transcripts.types.js';

/**
 * Transcripts Indexer Service
 *
 * Discovers earnings call transcripts from FMP API and creates Document records.
 *
 * Responsibilities:
 * - Fetch transcript metadata from FMP (backfill + incremental)
 * - Match transcripts to instruments via ticker
 * - Create Document + DocumentInstrument records
 * - Deduplication via sourceId (fmp-transcript-{symbol}-{year}-Q{quarter})
 */
export class TranscriptsIndexerService {
  private fmp: FmpTranscriptsApiAdapter;
  private documentRepo: DocumentRepository;
  private instrumentRepo: InstrumentRepository;
  private logger;

  constructor() {
    this.fmp = new FmpTranscriptsApiAdapter();
    this.documentRepo = new DocumentRepository();
    this.instrumentRepo = new InstrumentRepository();
    this.logger = getLogger();
  }

  /**
   * Discover recent transcripts (incremental mode)
   * Fetches transcripts from last 90 days for active instruments
   *
   * @returns Number of new transcripts discovered
   */
  async discoverRecentTranscripts(): Promise<number> {
    this.logger.info('Starting incremental transcript discovery');

    const to = new Date();
    const from = new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000); // 90 days ago

    try {
      let totalCount = 0;
      let offset = 0;
      const batchSize = 100;

      while (true) {
        // Fetch active instruments in batches (type: STOCK, isActive: true)
        const { instruments, total } = await this.instrumentRepo.findMany({
          type: 'STOCK',
          isActive: true,
          limit: batchSize,
          offset,
        });

        if (instruments.length === 0) break;

        this.logger.debug(
          { offset, batchSize, total },
          'Processing instrument batch',
        );

        // Fetch transcripts for each ticker in this batch
        for (const instrument of instruments) {
          if (!instrument.symbol) continue;

          try {
            const transcripts = await this.fmp.getTranscriptsInRange(
              instrument.symbol,
              from,
              to,
            );

            if (transcripts.length > 0) {
              const count = await this.insertDiscoveredTranscripts(
                transcripts,
                instrument.id,
              );
              totalCount += count;
            }
          } catch (error) {
            this.logger.debug(
              { err: error, symbol: instrument.symbol },
              'Failed to fetch transcripts for ticker (continuing)',
            );
            // Continue with next ticker
          }
        }

        offset += batchSize;

        // If we've fetched all instruments, break
        if (offset >= total) break;
      }

      this.logger.info({ count: totalCount }, 'Incremental transcript discovery complete');
      return totalCount;
    } catch (error) {
      this.logger.error({ err: error, phase: 'DISCOVERY' }, 'Failed to discover recent transcripts');
      throw error;
    }
  }

  /**
   * Backfill historical transcripts
   *
   * @param lookbackDays Number of days to look back
   * @returns Number of new transcripts discovered
   */
  async backfillHistoricalTranscripts(lookbackDays: number): Promise<number> {
    this.logger.info({ lookbackDays }, 'Starting historical transcript backfill');

    const to = new Date();
    const from = new Date(to.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

    try {
      let totalCount = 0;
      let oldestDate: Date | null = null;
      let offset = 0;
      const batchSize = 100;

      while (true) {
        // Fetch active instruments in batches (type: STOCK, isActive: true)
        const { instruments, total } = await this.instrumentRepo.findMany({
          type: 'STOCK',
          isActive: true,
          limit: batchSize,
          offset,
        });

        if (instruments.length === 0) break;

        this.logger.info(
          {
            offset,
            batchSize,
            total,
            from: from.toISOString().split('T')[0],
            to: to.toISOString().split('T')[0],
          },
          'Processing backfill batch',
        );

        // Fetch transcripts for each ticker in this batch
        for (const instrument of instruments) {
          if (!instrument.symbol) continue;

          try {
            const transcripts = await this.fmp.getTranscriptsInRange(
              instrument.symbol,
              from,
              to,
            );

            if (transcripts.length > 0) {
              const count = await this.insertDiscoveredTranscripts(
                transcripts,
                instrument.id,
              );
              totalCount += count;

              // Track oldest transcript date
              for (const t of transcripts) {
                const transcriptDate = new Date(t.date);
                if (!oldestDate || transcriptDate < oldestDate) {
                  oldestDate = transcriptDate;
                }
              }
            }
          } catch (error) {
            this.logger.debug(
              { err: error, symbol: instrument.symbol },
              'Failed to fetch transcripts for ticker (continuing)',
            );
            // Continue with next ticker
          }
        }

        offset += batchSize;

        // If we've fetched all instruments, break
        if (offset >= total) break;
      }

      this.logger.info(
        {
          totalCount,
          oldestDate: oldestDate?.toISOString().split('T')[0] || 'N/A',
        },
        'Historical transcript backfill complete',
      );

      return totalCount;
    } catch (error) {
      this.logger.error({ err: error, phase: 'BACKFILL' }, 'Failed to backfill historical transcripts');
      throw error;
    }
  }

  /**
   * Insert discovered transcripts into database with deduplication
   *
   * @param transcripts FMP transcript metadata
   * @param instrumentId Instrument ID for linking
   * @returns Number of new transcripts inserted
   */
  private async insertDiscoveredTranscripts(
    transcripts: FmpTranscriptListResponse[],
    instrumentId: string,
  ): Promise<number> {
    if (transcripts.length === 0) {
      return 0;
    }

    // Build sourceIds: fmp-transcript-{symbol}-{year}-Q{quarter}
    const sourceIds = transcripts.map(
      (t) => `fmp-transcript-${t.symbol}-${t.year}-Q${t.quarter}`,
    );

    // Deduplicate: check which transcripts already exist
    const existingSourceIds = await this.documentRepo.findBySourceIds(sourceIds);
    const existingSet = new Set(existingSourceIds);

    const newTranscripts = transcripts.filter((t) => {
      const sourceId = `fmp-transcript-${t.symbol}-${t.year}-Q${t.quarter}`;
      return !existingSet.has(sourceId);
    });

    if (newTranscripts.length === 0) {
      this.logger.debug('No new transcripts to insert (all duplicates)');
      return 0;
    }

    this.logger.info(
      {
        total: transcripts.length,
        new: newTranscripts.length,
        symbol: transcripts[0]?.symbol,
      },
      'Inserting new transcripts',
    );

    // Create Document records
    const documents: CreateDocumentInput[] = newTranscripts.map((t) => ({
      documentType: 'EARNINGS_TRANSCRIPT',
      sourceId: `fmp-transcript-${t.symbol}-${t.year}-Q${t.quarter}`,
      sourceUrl: `https://financialmodelingprep.com/api/v3/earning_call_transcript/${t.symbol}?quarter=${t.quarter}&year=${t.year}`,
      title: `${t.symbol} Q${t.quarter} ${t.year} Earnings Call Transcript`,
      publishedAt: new Date(t.date),
      metadata: {
        callType: 'EARNINGS',
        fiscalQuarter: `Q${t.quarter} ${t.year}`,
        fiscalYear: t.year,
        symbol: t.symbol,
        quarter: t.quarter,
      },
    }));

    const insertedCount = await this.documentRepo.batchInsert(documents);

    // Link transcripts to instruments
    await this.linkTranscriptsToInstruments(newTranscripts, instrumentId);

    return insertedCount;
  }

  /**
   * Link transcripts to instruments
   *
   * @param transcripts FMP transcript metadata
   * @param instrumentId Instrument ID for linking
   */
  private async linkTranscriptsToInstruments(
    transcripts: FmpTranscriptListResponse[],
    instrumentId: string,
  ): Promise<void> {
    this.logger.debug(
      { count: transcripts.length, instrumentId },
      'Linking transcripts to instruments',
    );

    for (const transcript of transcripts) {
      try {
        const sourceId = `fmp-transcript-${transcript.symbol}-${transcript.year}-Q${transcript.quarter}`;

        // Find the document we just created
        const document = await this.documentRepo.findBySourceId(sourceId);

        if (!document) {
          this.logger.warn(
            { sourceId },
            'Document not found after insert',
          );
          continue;
        }

        // Create DocumentInstrument link
        const link: CreateDocumentInstrumentInput = {
          documentId: document.id,
          instrumentId,
          relevance: '1.0', // Direct match (transcript is for this specific ticker)
          matchMethod: 'DIRECT_TICKER',
        };

        await this.documentRepo.linkInstrument(link);

        this.logger.debug(
          { sourceId, instrumentId },
          'Linked transcript to instrument',
        );
      } catch (error) {
        this.logger.error(
          {
            err: error,
            transcript: `${transcript.symbol}-${transcript.year}-Q${transcript.quarter}`,
            phase: 'LINK_INSTRUMENTS',
          },
          'Failed to link transcript to instrument',
        );
        // Continue with next transcript
      }
    }
  }
}
