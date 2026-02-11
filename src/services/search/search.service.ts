import { esClient } from './elasticsearch.client.js';
import { IndexManagerService } from './index-manager.service.js';
import { getLogger } from '../../utils/logger.js';
import type { SearchDocument } from './search-indexer.service.js';

export interface SearchResult {
  entity_type: 'polymarket' | 'equity' | 'issuer' | 'tradingview_symbol' | 'signal';
  entity_id: string;
  primary_text: string;
  secondary_text?: string;
  symbol?: string | null;
  category?: string | null;
  has_signals: boolean;
  signal_count: number;
  metadata?: Record<string, any>;
  signal_type?: string;
  signal_severity?: string;
  signal_score?: number;
  instrument_id?: string;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  entity_types?: string[];
}

/**
 * TradingView symbol pattern: EXCHANGE:TICKER (e.g., NASDAQ:AAPL, NYSE:TSLA)
 */
const TRADINGVIEW_SYMBOL_PATTERN = /^([A-Z]+):([A-Z]+)$/;

/**
 * Executes search queries against the unified search index.
 */
export class SearchService {
  private indexManager: IndexManagerService | null = null;

  constructor() {
    // Lazy initialization
  }

  private getIndexManager(): IndexManagerService {
    if (!this.indexManager) {
      this.indexManager = new IndexManagerService();
    }
    return this.indexManager;
  }

  /**
   * Autocomplete search - returns top 3 results.
   */
  async autocomplete(query: string): Promise<SearchResult[]> {
    const results = await this.search(query, { limit: 3 });
    return results.results;
  }

  /**
   * Full search with pagination and filtering.
   */
  async fullSearch(query: string, options: SearchOptions = {}): Promise<{
    results: SearchResult[];
    total: number;
  }> {
    return this.search(query, {
      limit: options.limit || 20,
      offset: options.offset || 0,
      entity_types: options.entity_types,
    });
  }

  /**
   * Core search method with TradingView synthetic symbol detection.
   */
  private async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<{
    results: SearchResult[];
    total: number;
  }> {
    const client = esClient.getClient();
    const indexName = this.getIndexManager().getIndexName();
    const limit = options.limit || 3;
    const offset = options.offset || 0;

    try {
      // Build query filters
      const filters: any[] = [];

      if (options.entity_types && options.entity_types.length > 0) {
        filters.push({
          terms: { entity_type: options.entity_types },
        });
      }

      // Multi-match query with boosting
      const mustQueries: any[] = [
        {
          bool: {
            should: [
              // Exact symbol match (highest priority)
              {
                term: {
                  'symbol.exact': {
                    value: query,
                    boost: 10,
                  },
                },
              },
              // Exact primary text match
              {
                term: {
                  'primary_text.exact': {
                    value: query,
                    boost: 5,
                  },
                },
              },
              // Autocomplete primary text
              {
                match: {
                  primary_text: {
                    query: query,
                    boost: 3,
                  },
                },
              },
              // Symbol prefix
              {
                match: {
                  symbol: {
                    query: query,
                    boost: 8,
                  },
                },
              },
              // Secondary text
              {
                match: {
                  secondary_text: {
                    query: query,
                    boost: 1,
                  },
                },
              },
            ],
            minimum_should_match: 1,
          },
        },
      ];

      // Execute search
      const response = await client.search({
        index: indexName,
        body: {
          query: {
            bool: {
              must: mustQueries,
              filter: filters.length > 0 ? filters : undefined,
              should: [
                // Boost documents with signals
                {
                  term: {
                    has_signals: {
                      value: true,
                      boost: 5,
                    },
                  },
                },
                // Boost active entities
                {
                  term: {
                    is_active: {
                      value: true,
                      boost: 2,
                    },
                  },
                },
                // Boost by signal count
                {
                  range: {
                    signal_count: {
                      gte: 1,
                      boost: 3,
                    },
                  },
                },
              ],
            },
          },
          sort: [
            { _score: { order: 'desc' } },
            { signal_count: { order: 'desc' } },
            { has_signals: { order: 'desc' } },
            { last_updated: { order: 'desc' } },
          ],
          from: offset,
          size: limit,
        },
      });

      const hits = response.body.hits.hits;
      const total = typeof response.body.hits.total === 'object'
        ? response.body.hits.total.value
        : response.body.hits.total;

      let results: SearchResult[] = hits.map((hit: any) => {
        const source = hit._source as SearchDocument;
        return {
          entity_type: source.entity_type,
          entity_id: source.entity_id,
          primary_text: source.primary_text,
          secondary_text: source.secondary_text,
          symbol: source.symbol,
          category: source.category,
          has_signals: source.has_signals,
          signal_count: source.signal_count,
          metadata: source.metadata,
          signal_type: source.signal_type,
          signal_severity: source.signal_severity,
          signal_score: source.signal_score,
          instrument_id: source.instrument_id,
        };
      });

      // TradingView synthetic symbol detection
      if (results.length === 0 && TRADINGVIEW_SYMBOL_PATTERN.test(query)) {
        const match = query.match(TRADINGVIEW_SYMBOL_PATTERN);
        if (match) {
          const [, exchange, ticker] = match;
          const syntheticId = `synthetic_${exchange}_${ticker}`;

          const logger = getLogger();
          logger.info(`No results found for TradingView symbol ${query}, returning synthetic result`);

          results = [{
            entity_type: 'tradingview_symbol',
            entity_id: syntheticId,
            primary_text: `${exchange}:${ticker}`,
            secondary_text: 'TradingView Symbol',
            symbol: `${exchange}:${ticker}`,
            category: 'tradingview',
            has_signals: false,
            signal_count: 0,
            metadata: {
              exchange,
              ticker,
              synthetic: true,
            },
          }];

          return { results, total: 1 };
        }
      }

      return { results, total };
    } catch (error) {
      const logger = getLogger();
      logger.error({
        err: error,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        query,
        options,
      }, 'Search query failed');
      throw error;
    }
  }
}
