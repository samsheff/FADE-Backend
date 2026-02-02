import { getEnvironment } from '../../config/environment.js';
import { getLogger } from '../../utils/logger.js';
import { RateLimiter } from '../../utils/rate-limiter.js';

export interface PolymarketMarket {
  id: string;
  polymarketMarketId: string | null;
  question: string;
  outcomes: string[];
  expiryDate: Date;
  marketSlug: string;
  categoryTag: string | null;
  active: boolean;
  tokens: Record<string, string>;
}

export interface PolymarketMarketState {
  yesPrice: string | null;
  noPrice: string | null;
  liquidity: string | null;
  volume: string | null;
  lastUpdatedBlock: string | null;
}

interface PolymarketGammaMarketResponse {
  conditionId?: string;
  id?: string;
  marketId?: string | number;
  question?: string;
  outcomes?: string[] | string;
  outcomePrices?: string[] | string;
  endDate?: string;
  end_date_iso?: string;
  endDateIso?: string;
  end_date?: string;
  slug?: string;
  category?: string;
  tags?: string[];
  active?: boolean;
  clobTokenIds?: string[] | string;
  liquidity?: string;
  volume?: string;
  updatedAt?: string;
}

export class PolymarketAdapter {
  private logger;
  private gammaApiUrl: string;
  private gammaCache = new Map<string, { data: PolymarketGammaMarketResponse | null; expiresAt: number }>();
  private static readonly GAMMA_CACHE_TTL_MS = 30_000;
  private static readonly GAMMA_CACHE_MAX = 5000;
  private rateLimiter: RateLimiter;
  private bulkRateLimiter: RateLimiter;

  constructor() {
    const env = getEnvironment();
    this.logger = getLogger();
    this.gammaApiUrl = env.POLYMARKET_GAMMA_API_URL;
    this.rateLimiter = new RateLimiter(env.GAMMA_API_REQUEST_INTERVAL_MS);
    // Use faster rate limiting for bulk pagination (200 markets per request)
    this.bulkRateLimiter = new RateLimiter(Math.max(500, env.GAMMA_API_REQUEST_INTERVAL_MS / 2));
  }

  async getAllMarkets(): Promise<PolymarketMarket[]> {
    try {
      const markets: PolymarketMarket[] = [];
      const limit = 200;
      let offset = 0;
      let page = 0;

      while (true) {
        page++;
        const url = new URL(`${this.gammaApiUrl}/markets`);
        url.searchParams.set('limit', limit.toString());
        url.searchParams.set('offset', offset.toString());
        url.searchParams.set('closed', 'false');

        // Apply rate limiting (use bulk rate limiter for pagination)
        await this.bulkRateLimiter.wait();

        const response = await fetch(url.toString());

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const backoffMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;

          this.logger.warn(
            { offset, backoffMs },
            'Rate limited while fetching markets, waiting before retry',
          );

          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue; // Retry the same request
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data: PolymarketGammaMarketResponse[] = await response.json();
        const batch = data.map((market) => this.toMarket(market)).filter((market) => market.id);
        markets.push(...batch);

        this.logger.debug(
          { page, offset, batchSize: batch.length, totalMarkets: markets.length },
          'Fetched market page',
        );

        if (data.length < limit) {
          break;
        }

        offset += limit;
      }

      return markets;
    } catch (error) {
      this.logger.error({ error }, 'Failed to fetch markets from Gamma API');
      throw error;
    }
  }

  async getMarketById(conditionId: string): Promise<PolymarketMarket | null> {
    try {
      const gammaMarket = await this.fetchGammaMarket(conditionId);
      if (!gammaMarket) {
        return null;
      }
      return this.toMarket(gammaMarket);
    } catch (error) {
      this.logger.error({ error, conditionId }, 'Failed to fetch market by id from Gamma API');
      throw error;
    }
  }

  async getMarketState(conditionId: string): Promise<PolymarketMarketState> {
    try {
      const gammaMarket = await this.fetchGammaMarket(conditionId);
      if (!gammaMarket) {
        return {
          yesPrice: null,
          noPrice: null,
          liquidity: null,
          volume: null,
          lastUpdatedBlock: null,
        };
      }

      const { yesPrice, noPrice } = this.extractYesNoPrices(
        gammaMarket.outcomes,
        gammaMarket.outcomePrices,
      );

      return {
        yesPrice,
        noPrice,
        liquidity: gammaMarket.liquidity || null,
        volume: gammaMarket.volume || null,
        lastUpdatedBlock: gammaMarket.updatedAt
          ? Math.floor(new Date(gammaMarket.updatedAt).getTime() / 1000).toString()
          : null,
      };
    } catch (error) {
      this.logger.error({ error, conditionId }, 'Failed to fetch market state from Gamma API');
      throw error;
    }
  }

  async getOutcomePrices(conditionId: string): Promise<{ yesPrice: string | null; noPrice: string | null }> {
    const state = await this.getMarketState(conditionId);
    return { yesPrice: state.yesPrice, noPrice: state.noPrice };
  }

  async getCurrentBlockNumber(): Promise<bigint> {
    return 0n;
  }

  private toMarket(data: PolymarketGammaMarketResponse): PolymarketMarket {
    const rawOutcomes = this.normalizeStringArray(data.outcomes);
    const tokenIds = this.normalizeStringArray(data.clobTokenIds);

    // Normalize outcomes to uppercase for consistency (YES/NO instead of Yes/No)
    const outcomes = rawOutcomes.map((o) => o.toUpperCase());
    const tokens: Record<string, string> = {};
    outcomes.forEach((outcome, index) => {
      tokens[outcome] = tokenIds[index] || '';
    });

    // Debug log for first few markets to see what we're getting
    if (tokenIds.length === 0 && outcomes.length > 0) {
      this.logger.warn(
        {
          conditionId: data.conditionId?.slice(0, 8),
          question: data.question?.slice(0, 50),
          hasClobTokenIds: !!data.clobTokenIds,
          clobTokenIdsType: typeof data.clobTokenIds,
          clobTokenIdsValue: data.clobTokenIds,
        },
        'Market missing CLOB token IDs',
      );
    }

    const expiryDateRaw =
      data.endDate || data.end_date_iso || data.endDateIso || data.end_date || undefined;
    const expiryDate = expiryDateRaw ? new Date(expiryDateRaw) : new Date(0);

    return {
      id: data.conditionId || data.id || '',
      polymarketMarketId: data.marketId ? data.marketId.toString() : null,
      question: data.question || 'Unknown market',
      outcomes,
      expiryDate,
      marketSlug: data.slug || data.conditionId || data.id || '',
      categoryTag: data.tags?.[0] || data.category || null,
      active: data.active ?? true,
      tokens,
    };
  }

  private normalizeStringArray(value?: string[] | string): string[] {
    if (!value) {
      return [];
    }
    if (Array.isArray(value)) {
      return value;
    }
    try {
      const parsed = JSON.parse(value) as string[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private extractYesNoPrices(
    outcomes?: string[] | string,
    outcomePrices?: string[] | string,
  ): { yesPrice: string | null; noPrice: string | null } {
    const normalizedOutcomes = this.normalizeStringArray(outcomes).map((outcome) =>
      outcome.toUpperCase(),
    );
    const prices = this.normalizeStringArray(outcomePrices);
    const yesIndex = normalizedOutcomes.indexOf('YES');
    const noIndex = normalizedOutcomes.indexOf('NO');

    return {
      yesPrice: yesIndex >= 0 ? prices[yesIndex] || null : null,
      noPrice: noIndex >= 0 ? prices[noIndex] || null : null,
    };
  }

  private async fetchGammaMarket(
    conditionId: string,
  ): Promise<PolymarketGammaMarketResponse | null> {
    const cached = this.gammaCache.get(conditionId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const url = new URL(`${this.gammaApiUrl}/markets`);
    url.searchParams.set('condition_ids', conditionId);
    url.searchParams.set('limit', '1');

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await this.rateLimiter.wait();

      const response = await fetch(url.toString());

      // Handle rate limiting with exponential backoff
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const backoffMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.min(2000 * Math.pow(2, attempt), 30000);

        this.logger.warn(
          {
            conditionId,
            attempt: attempt + 1,
            maxRetries: maxRetries + 1,
            backoffMs,
          },
          'Rate limited by Gamma API, retrying with backoff',
        );

        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }
      }

      if (!response.ok) {
        let bodySnippet = '';
        try {
          const text = await response.text();
          bodySnippet = text.slice(0, 500);
        } catch {
          bodySnippet = '';
        }
        lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
        this.logger.error(
          {
            status: response.status,
            statusText: response.statusText,
            bodySnippet,
            conditionId,
            attempt: attempt + 1,
          },
          'Gamma API request failed',
        );

        // Only retry on 5xx errors or rate limiting
        if (response.status >= 500 && attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }

        throw lastError;
      }

      const data = (await response.json()) as PolymarketGammaMarketResponse[];
      const market = data[0] ?? null;

      if (this.gammaCache.size > PolymarketAdapter.GAMMA_CACHE_MAX) {
        this.gammaCache.clear();
      }
      this.gammaCache.set(conditionId, {
        data: market,
        expiresAt: Date.now() + PolymarketAdapter.GAMMA_CACHE_TTL_MS,
      });

      return market;
    }

    throw lastError || new Error('Failed to fetch gamma market after retries');
  }
}
