import { esClient } from './elasticsearch.client.js';
import { IndexManagerService } from './index-manager.service.js';
import { getPrismaClient } from '../../adapters/database/client.js';
import { getLogger } from '../../utils/logger.js';
import { getEnvironment } from '../../config/environment.js';

/**
 * Document types for the unified search index
 */
export interface SearchDocument {
  entity_type: 'polymarket' | 'equity' | 'issuer' | 'tradingview_symbol' | 'signal';
  entity_id: string;
  primary_text: string;
  secondary_text?: string;
  symbol?: string | null;
  category?: string | null;
  tags?: string[];
  has_signals: boolean;
  signal_count: number;
  is_active: boolean;
  liquidity?: number;
  volume?: number;
  last_updated: Date;
  metadata?: Record<string, any>;

  // Signal-specific fields
  signal_type?: string;
  signal_severity?: string;
  signal_score?: number;
  instrument_id?: string;
}

/**
 * Indexes data into Elasticsearch for global search.
 */
export class SearchIndexerService {
  private readonly indexManager: IndexManagerService;
  private readonly batchSize: number;

  constructor() {
    this.indexManager = new IndexManagerService();
    const env = getEnvironment();
    this.batchSize = env.SEARCH_INDEXER_BATCH_SIZE;
  }

  /**
   * Index a single Polymarket market by ID.
   */
  async indexMarket(marketId: string): Promise<void> {
    try {
      const db = getPrismaClient();
      const market = await db.market.findUnique({
        where: { id: marketId },
      });

      if (!market) {
        const logger = getLogger();
        logger.warn(`Market ${marketId} not found for indexing`);
        return;
      }

      const document: SearchDocument = {
        entity_type: 'polymarket',
        entity_id: market.id,
        primary_text: market.question,
        secondary_text: market.categoryTag || undefined,
        symbol: null,
        category: market.categoryTag || null,
        tags: market.categoryTag ? [market.categoryTag] : [],
        has_signals: false, // Polymarket markets don't have signals
        signal_count: 0,
        is_active: market.active,
        liquidity: market.liquidity.toNumber(),
        volume: market.volume24h.toNumber(),
        last_updated: market.lastUpdated,
        metadata: {
          marketSlug: market.marketSlug,
          expiryDate: market.expiryDate.toISOString(),
          yesPrice: market.yesPrice?.toNumber(),
          noPrice: market.noPrice?.toNumber(),
        },
      };

      await this.indexDocument(document);
      const logger = getLogger();
      logger.debug(`Indexed market ${marketId}`);
    } catch (error) {
      const logger = getLogger();
      logger.error(`Failed to index market ${marketId}:`, error);
      throw error;
    }
  }

  /**
   * Index a single instrument by ID.
   * Auto-detects whether it's an equity or SEC issuer based on CIK.
   */
  async indexInstrument(instrumentId: string): Promise<void> {
    try {
      const db = getPrismaClient();
      const instrument = await db.instrument.findUnique({
        where: { id: instrumentId },
        include: {
          identifiers: true,
          signals: {
            where: {
              OR: [
                { expiresAt: null },
                { expiresAt: { gt: new Date() } },
              ],
            },
          },
        },
      });

      if (!instrument) {
        const logger = getLogger();
        logger.warn(`Instrument ${instrumentId} not found for indexing`);
        return;
      }

      // Check if instrument has a CIK identifier
      const cikIdentifier = instrument.identifiers.find(id => id.type === 'CIK');
      const entityType = cikIdentifier ? 'issuer' : 'equity';

      const document: SearchDocument = {
        entity_type: entityType,
        entity_id: instrument.id,
        primary_text: instrument.name,
        secondary_text: instrument.exchange || undefined,
        symbol: instrument.symbol,
        category: instrument.type,
        tags: [instrument.type, instrument.status],
        has_signals: instrument.signals.length > 0,
        signal_count: instrument.signals.length,
        is_active: instrument.isActive && instrument.status === 'ACTIVE',
        liquidity: undefined,
        volume: undefined,
        last_updated: instrument.updatedAt,
        metadata: {
          exchange: instrument.exchange,
          currency: instrument.currency,
          tradeable: instrument.tradeable,
          cik: cikIdentifier?.value,
          lastFilingAt: instrument.lastFilingAt?.toISOString(),
          firstSeenAt: instrument.firstSeenAt?.toISOString(),
          metadataSource: instrument.metadataSource,
        },
      };

      await this.indexDocument(document);
      const logger = getLogger();
      logger.debug(`Indexed ${entityType} instrument ${instrumentId}`);
    } catch (error) {
      const logger = getLogger();
      logger.error(`Failed to index instrument ${instrumentId}:`, error);
      throw error;
    }
  }

  /**
   * Index all markets in batches.
   */
  async indexAllMarkets(): Promise<void> {
    const logger = getLogger();
    logger.info('Starting full market indexing...');

    const db = getPrismaClient();
    let offset = 0;
    let indexed = 0;

    while (true) {
      const markets = await db.market.findMany({
        take: this.batchSize,
        skip: offset,
        orderBy: { lastUpdated: 'desc' },
      });

      if (markets.length === 0) {
        break;
      }

      const documents: SearchDocument[] = markets.map(market => ({
        entity_type: 'polymarket',
        entity_id: market.id,
        primary_text: market.question,
        secondary_text: market.categoryTag || undefined,
        symbol: null,
        category: market.categoryTag || null,
        tags: market.categoryTag ? [market.categoryTag] : [],
        has_signals: false,
        signal_count: 0,
        is_active: market.active,
        liquidity: market.liquidity.toNumber(),
        volume: market.volume24h.toNumber(),
        last_updated: market.lastUpdated,
        metadata: {
          marketSlug: market.marketSlug,
          expiryDate: market.expiryDate.toISOString(),
          yesPrice: market.yesPrice?.toNumber(),
          noPrice: market.noPrice?.toNumber(),
        },
      }));

      await this.bulkIndexDocuments(documents);

      indexed += documents.length;
      offset += this.batchSize;

      logger.info(`Indexed ${indexed} markets...`);
    }

    logger.info(`Completed market indexing: ${indexed} total markets`);
  }

  /**
   * Index all instruments in batches.
   */
  async indexAllInstruments(): Promise<void> {
    const logger = getLogger();
    logger.info('Starting full instrument indexing...');

    const db = getPrismaClient();
    let offset = 0;
    let indexed = 0;

    while (true) {
      const instruments = await db.instrument.findMany({
        take: this.batchSize,
        skip: offset,
        orderBy: { updatedAt: 'desc' },
        include: {
          identifiers: true,
          signals: {
            where: {
              OR: [
                { expiresAt: null },
                { expiresAt: { gt: new Date() } },
              ],
            },
          },
        },
      });

      if (instruments.length === 0) {
        break;
      }

      const documents: SearchDocument[] = instruments.map(instrument => {
        const cikIdentifier = instrument.identifiers.find(id => id.type === 'CIK');
        const entityType = cikIdentifier ? 'issuer' : 'equity';

        return {
          entity_type: entityType,
          entity_id: instrument.id,
          primary_text: instrument.name,
          secondary_text: instrument.exchange || undefined,
          symbol: instrument.symbol,
          category: instrument.type,
          tags: [instrument.type, instrument.status],
          has_signals: instrument.signals.length > 0,
          signal_count: instrument.signals.length,
          is_active: instrument.isActive && instrument.status === 'ACTIVE',
          liquidity: undefined,
          volume: undefined,
          last_updated: instrument.updatedAt,
          metadata: {
            exchange: instrument.exchange,
            currency: instrument.currency,
            tradeable: instrument.tradeable,
            cik: cikIdentifier?.value,
            lastFilingAt: instrument.lastFilingAt?.toISOString(),
            firstSeenAt: instrument.firstSeenAt?.toISOString(),
            metadataSource: instrument.metadataSource,
          },
        };
      });

      await this.bulkIndexDocuments(documents);

      indexed += documents.length;
      offset += this.batchSize;

      logger.info(`Indexed ${indexed} instruments...`);
    }

    logger.info(`Completed instrument indexing: ${indexed} total instruments`);
  }

  /**
   * Index a single signal by ID.
   */
  async indexSignal(signalId: string): Promise<void> {
    try {
      const db = getPrismaClient();
      const signal = await db.instrumentSignal.findUnique({
        where: { id: signalId },
        include: {
          instrument: {
            include: { identifiers: true },
          },
        },
      });

      if (!signal) {
        const logger = getLogger();
        logger.warn(`Signal ${signalId} not found for indexing`);
        return;
      }

      const document: SearchDocument = {
        entity_type: 'signal',
        entity_id: signal.id,
        primary_text: signal.reason, // Searchable reason text
        secondary_text: `${signal.instrument.name} (${signal.instrument.symbol})`,
        symbol: signal.instrument.symbol,
        category: signal.signalType,
        tags: [signal.signalType, signal.severity, signal.instrument.type],
        has_signals: true,
        signal_count: 1,
        is_active: signal.expiresAt ? new Date() < signal.expiresAt : true,
        last_updated: signal.computedAt,
        metadata: {
          instrumentId: signal.instrumentId,
          instrumentName: signal.instrument.name,
          severity: signal.severity,
          score: signal.score.toString(),
        },
        signal_type: signal.signalType,
        signal_severity: signal.severity,
        signal_score: signal.score.toNumber(),
        instrument_id: signal.instrumentId,
      };

      await this.indexDocument(document);
    } catch (error) {
      const logger = getLogger();
      logger.error(`Failed to index signal ${signalId}:`, error);
      throw error;
    }
  }

  /**
   * Index all active signals in batches.
   */
  async indexAllSignals(): Promise<void> {
    const logger = getLogger();
    logger.info('Starting signal indexing...');

    const db = getPrismaClient();
    let offset = 0;
    let indexed = 0;

    while (true) {
      const signals = await db.instrumentSignal.findMany({
        take: this.batchSize,
        skip: offset,
        orderBy: { computedAt: 'desc' },
        include: {
          instrument: {
            include: { identifiers: true },
          },
        },
        where: {
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
      });

      if (signals.length === 0) break;

      const documents: SearchDocument[] = signals.map(signal => ({
        entity_type: 'signal',
        entity_id: signal.id,
        primary_text: signal.reason,
        secondary_text: `${signal.instrument.name} (${signal.instrument.symbol})`,
        symbol: signal.instrument.symbol,
        category: signal.signalType,
        tags: [signal.signalType, signal.severity, signal.instrument.type],
        has_signals: true,
        signal_count: 1,
        is_active: signal.expiresAt ? new Date() < signal.expiresAt : true,
        last_updated: signal.computedAt,
        metadata: {
          instrumentId: signal.instrumentId,
          instrumentName: signal.instrument.name,
          severity: signal.severity,
          score: signal.score.toString(),
        },
        signal_type: signal.signalType,
        signal_severity: signal.severity,
        signal_score: signal.score.toNumber(),
        instrument_id: signal.instrumentId,
      }));

      await this.bulkIndexDocuments(documents);
      indexed += documents.length;
      offset += this.batchSize;

      logger.info(`Indexed ${indexed} signals...`);
    }

    logger.info(`Completed signal indexing: ${indexed} total`);
  }

  /**
   * Delete a document from the index.
   */
  async deleteDocument(entityId: string): Promise<void> {
    const client = esClient.getClient();
    const indexName = this.indexManager.getIndexName();

    try {
      await client.delete({
        index: indexName,
        id: entityId,
      });

      const logger = getLogger();
      logger.debug(`Deleted document ${entityId} from search index`);
    } catch (error: any) {
      const logger = getLogger();
      if (error.meta?.statusCode === 404) {
        logger.debug(`Document ${entityId} not found in search index (already deleted)`);
        return;
      }

      logger.error(`Failed to delete document ${entityId}:`, error);
      throw error;
    }
  }

  /**
   * Index a single document.
   */
  private async indexDocument(document: SearchDocument): Promise<void> {
    const client = esClient.getClient();
    const indexName = this.indexManager.getIndexName();

    await client.index({
      index: indexName,
      id: document.entity_id,
      document,
    });

    // Refresh index to make document searchable immediately
    await this.indexManager.refreshIndex();
  }

  /**
   * Bulk index multiple documents.
   */
  private async bulkIndexDocuments(documents: SearchDocument[]): Promise<void> {
    if (documents.length === 0) {
      return;
    }

    const client = esClient.getClient();
    const indexName = this.indexManager.getIndexName();

    const operations = documents.flatMap(doc => [
      { index: { _index: indexName, _id: doc.entity_id } },
      doc,
    ]);

    const result = await client.bulk({ operations });

    if (result.errors) {
      const erroredItems = result.items.filter((item: any) => item.index?.error);
      logger.error(`Bulk indexing had ${erroredItems.length} errors:`, erroredItems);
    }
  }
}
