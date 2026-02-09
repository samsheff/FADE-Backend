import { FinnhubApiAdapter, FinnhubArticle } from '../../adapters/news/finnhub-api.adapter.js';
import { DocumentRepository } from '../../adapters/database/repositories/document.repository.js';
import { InstrumentRepository } from '../../adapters/database/repositories/instrument.repository.js';
import { getLogger } from '../../utils/logger.js';
import { CreateDocumentInput, CreateDocumentInstrumentInput } from '../../types/document.types.js';

/**
 * News Indexer Service
 *
 * Discovers news articles from Finnhub API and creates Document records.
 *
 * Responsibilities:
 * - Fetch articles from Finnhub (backfill + incremental)
 * - Match articles to instruments via ticker/CIK keywords
 * - Create Document + DocumentInstrument records
 * - Deduplication via sourceId
 */
export class NewsIndexerService {
  private finnhub: FinnhubApiAdapter;
  private documentRepo: DocumentRepository;
  private instrumentRepo: InstrumentRepository;
  private logger;

  constructor() {
    this.finnhub = new FinnhubApiAdapter();
    this.documentRepo = new DocumentRepository();
    this.instrumentRepo = new InstrumentRepository();
    this.logger = getLogger();
  }

  /**
   * Discover recent news (incremental mode)
   * Fetches news from last 24 hours
   *
   * @returns Number of new articles discovered
   */
  async discoverRecentNews(): Promise<number> {
    this.logger.info('Starting incremental news discovery');

    const to = new Date();
    const from = new Date(to.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago

    try {
      // Fetch general market news
      const articles = await this.finnhub.getMarketNews('general');

      this.logger.info(
        { count: articles.length, from, to },
        'Fetched recent market news',
      );

      const count = await this.insertDiscoveredArticles(articles);

      this.logger.info({ count }, 'Incremental news discovery complete');
      return count;
    } catch (error) {
      this.logger.error({ error }, 'Failed to discover recent news');
      throw error;
    }
  }

  /**
   * Backfill historical news
   *
   * @param lookbackDays Number of days to look back
   * @returns Number of new articles discovered
   */
  async backfillHistoricalNews(lookbackDays: number): Promise<number> {
    this.logger.info({ lookbackDays }, 'Starting historical news backfill');

    const to = new Date();
    const from = new Date(to.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

    let totalCount = 0;

    try {
      // Fetch general market news for the lookback period
      const articles = await this.finnhub.getMarketNews('general');

      // Filter to only articles within the lookback window
      const filteredArticles = articles.filter((article) => {
        const articleDate = new Date(article.datetime * 1000);
        return articleDate >= from && articleDate <= to;
      });

      this.logger.info(
        { total: articles.length, filtered: filteredArticles.length, from, to },
        'Fetched historical market news',
      );

      const count = await this.insertDiscoveredArticles(filteredArticles);
      totalCount += count;

      this.logger.info({ totalCount }, 'Historical news backfill complete');
      return totalCount;
    } catch (error) {
      this.logger.error({ error }, 'Failed to backfill historical news');
      throw error;
    }
  }

  /**
   * Insert discovered articles into database with deduplication
   *
   * @param articles Finnhub articles
   * @returns Number of new articles inserted
   */
  async insertDiscoveredArticles(
    articles: FinnhubArticle[],
  ): Promise<number> {
    if (articles.length === 0) {
      return 0;
    }

    // Deduplicate: check which articles already exist
    const sourceIds = articles.map((a) => `finnhub-${a.id}`);
    const existingSourceIds = await this.documentRepo.findBySourceIds(sourceIds);
    const existingSet = new Set(existingSourceIds);

    const newArticles = articles.filter(
      (article) => !existingSet.has(`finnhub-${article.id}`),
    );

    if (newArticles.length === 0) {
      this.logger.debug('No new articles to insert (all duplicates)');
      return 0;
    }

    this.logger.info(
      { total: articles.length, new: newArticles.length },
      'Inserting new articles',
    );

    // Create Document records
    const documents: CreateDocumentInput[] = newArticles.map((article) => ({
      documentType: 'NEWS_ARTICLE',
      sourceId: `finnhub-${article.id}`,
      sourceUrl: article.url,
      title: article.headline,
      publishedAt: new Date(article.datetime * 1000),
      metadata: {
        source: article.source,
        summary: article.summary,
        imageUrl: article.image,
        relatedTickers: article.related,
        category: article.category || 'general',
      },
    }));

    const insertedCount = await this.documentRepo.batchInsert(documents);

    // Link articles to instruments
    await this.linkArticlesToInstruments(newArticles);

    return insertedCount;
  }

  /**
   * Link articles to instruments based on ticker/CIK keyword matching
   *
   * @param articles Finnhub articles
   */
  private async linkArticlesToInstruments(
    articles: FinnhubArticle[],
  ): Promise<void> {
    this.logger.info({ count: articles.length }, 'Linking articles to instruments');

    for (const article of articles) {
      try {
        const instrumentIds = await this.resolveIssuers(article);

        if (instrumentIds.length === 0) {
          this.logger.debug(
            { articleId: article.id },
            'No instruments matched for article',
          );
          continue;
        }

        // Find the document we just created
        const document = await this.documentRepo.findBySourceId(
          `finnhub-${article.id}`,
        );

        if (!document) {
          this.logger.warn(
            { articleId: article.id },
            'Document not found after insert',
          );
          continue;
        }

        // Create DocumentInstrument links
        const links: CreateDocumentInstrumentInput[] = instrumentIds.map(
          (instrumentId) => ({
            documentId: document.id,
            instrumentId,
            relevance: '1.0', // Default relevance
            matchMethod: 'TICKER_KEYWORD',
          }),
        );

        await this.documentRepo.batchLinkInstruments(links);

        this.logger.debug(
          { articleId: article.id, instrumentCount: instrumentIds.length },
          'Linked article to instruments',
        );
      } catch (error) {
        this.logger.error(
          { error, articleId: article.id },
          'Failed to link article to instruments',
        );
        // Continue with next article
      }
    }
  }

  /**
   * Resolve instrument IDs from article text via ticker/CIK matching
   *
   * @param article Finnhub article
   * @returns Array of instrument IDs
   */
  private async resolveIssuers(article: FinnhubArticle): Promise<string[]> {
    const instrumentIds: string[] = [];
    const searchText = `${article.headline} ${article.summary} ${article.related}`.toUpperCase();

    // Extract tickers from 'related' field (comma-separated)
    const relatedTickers = article.related
      ? article.related.split(',').map((t) => t.trim())
      : [];

    // Search for each ticker in our database
    for (const ticker of relatedTickers) {
      if (!ticker) continue;

      try {
        const instrument = await this.instrumentRepo.findBySymbol(ticker);
        if (instrument) {
          instrumentIds.push(instrument.id);
        }
      } catch (error) {
        this.logger.debug({ ticker, error }, 'Failed to find instrument by ticker');
      }
    }

    // Also search for ticker patterns in text ($AAPL, AAPL)
    const tickerPattern = /\b[A-Z]{1,5}\b/g;
    const potentialTickers = searchText.match(tickerPattern) || [];

    for (const ticker of potentialTickers) {
      // Skip common words
      if (['THE', 'AND', 'FOR', 'WITH', 'FROM', 'CEO', 'CFO'].includes(ticker)) {
        continue;
      }

      try {
        const instrument = await this.instrumentRepo.findBySymbol(ticker);
        if (instrument && !instrumentIds.includes(instrument.id)) {
          instrumentIds.push(instrument.id);
        }
      } catch (error) {
        // Silently skip (most won't be valid tickers)
      }
    }

    return [...new Set(instrumentIds)]; // Deduplicate
  }
}
