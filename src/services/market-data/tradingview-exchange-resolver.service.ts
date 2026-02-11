/**
 * TradingView Exchange Resolution Service
 *
 * Resolves exchange prefixes for ticker symbols using TradingView's search API.
 * Caches results to avoid repeated API calls.
 */

import { getLogger } from '../../utils/logger.js';
import { InstrumentType } from '../../types/instrument.types.js';

export interface ExchangeResolutionResult {
  tvSymbol: string;
  exchange: string;
  symbol: string;
  description: string;
  type: string;
  confidence: number;
}

export class TradingViewExchangeResolverService {
  private logger;
  private cache: Map<string, ExchangeResolutionResult | null>;

  // Exchange preference order (higher = more preferred)
  private static readonly EXCHANGE_PREFERENCE = {
    NASDAQ: 4,
    NYSE: 3,
    AMEX: 2,
    OTC: 1,
  };

  constructor() {
    this.logger = getLogger();
    this.cache = new Map();
  }

  /**
   * Resolve TradingView exchange prefix for a symbol
   *
   * @param symbol - Bare ticker symbol (e.g., "AAPL")
   * @param instrumentType - Type of instrument (EQUITY, ETF, etc.)
   * @returns Resolution result or null if not found
   */
  async resolveSymbol(
    symbol: string,
    instrumentType: InstrumentType,
  ): Promise<ExchangeResolutionResult | null> {
    const cacheKey = `${symbol}:${instrumentType}`;

    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) || null;
    }

    try {
      this.logger.debug({ symbol, instrumentType }, 'Resolving TradingView exchange');

      // Dynamic import to avoid top-level await issues
      const { searchMarket } = await import('@mathieuc/tradingview');

      // Search TradingView for the symbol
      const results = await searchMarket(symbol);

      if (!results || results.length === 0) {
        this.logger.debug({ symbol }, 'No TradingView results found');
        this.cache.set(cacheKey, null);
        return null;
      }

      // Filter for exact symbol matches
      const exactMatches = results.filter(
        (r) => r.symbol?.toUpperCase() === symbol.toUpperCase(),
      );

      if (exactMatches.length === 0) {
        this.logger.debug({ symbol }, 'No exact symbol matches found');
        this.cache.set(cacheKey, null);
        return null;
      }

      // Apply exchange preference logic and type matching
      const bestMatch = this.selectBestMatch(exactMatches, instrumentType);

      if (!bestMatch) {
        this.logger.debug({ symbol }, 'No suitable match found');
        this.cache.set(cacheKey, null);
        return null;
      }

      // Extract exchange from the full symbol (e.g., "NASDAQ:AAPL" -> "NASDAQ")
      const fullSymbol = bestMatch.symbol || '';
      const parts = fullSymbol.split(':');
      const exchange = parts.length > 1 ? parts[0] : 'UNKNOWN';
      const symbolPart = parts.length > 1 ? parts[1] : parts[0];

      const result: ExchangeResolutionResult = {
        tvSymbol: fullSymbol,
        exchange,
        symbol: symbolPart,
        description: bestMatch.description || '',
        type: bestMatch.type || 'unknown',
        confidence: this.calculateConfidence(bestMatch, instrumentType),
      };

      this.logger.info(
        {
          symbol,
          tvSymbol: result.tvSymbol,
          exchange: result.exchange,
          confidence: result.confidence,
        },
        'Exchange resolved successfully',
      );

      // Cache the result
      this.cache.set(cacheKey, result);

      return result;
    } catch (error) {
      this.logger.warn({ error, symbol }, 'Exchange resolution failed');
      this.cache.set(cacheKey, null);
      return null;
    }
  }

  /**
   * Select the best match from TradingView results
   */
  private selectBestMatch(results: any[], instrumentType: InstrumentType): any | null {
    if (results.length === 1) {
      return results[0];
    }

    // Score each result
    const scored = results.map((result) => {
      let score = 0;

      // Extract exchange from full symbol
      const fullSymbol = result.symbol || '';
      const parts = fullSymbol.split(':');
      const exchange = parts.length > 1 ? parts[0].toUpperCase() : 'UNKNOWN';

      // Apply exchange preference
      const exchangePref = TradingViewExchangeResolverService.EXCHANGE_PREFERENCE[exchange as keyof typeof TradingViewExchangeResolverService.EXCHANGE_PREFERENCE] || 0;
      score += exchangePref * 10;

      // Prefer matching instrument type
      const resultType = (result.type || '').toLowerCase();
      if (instrumentType === InstrumentType.ETF) {
        if (resultType.includes('fund') || resultType.includes('etf')) {
          score += 20;
        }
      } else if (instrumentType === InstrumentType.EQUITY) {
        if (resultType.includes('stock') || resultType.includes('equity')) {
          score += 20;
        }
      }

      // Prefer results from major exchanges
      if (['NASDAQ', 'NYSE'].includes(exchange)) {
        score += 5;
      }

      return { result, score };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    return scored.length > 0 ? scored[0].result : null;
  }

  /**
   * Calculate confidence score for a match
   */
  private calculateConfidence(result: any, instrumentType: InstrumentType): number {
    let confidence = 0.5; // Base confidence

    const resultType = (result.type || '').toLowerCase();
    const fullSymbol = result.symbol || '';
    const parts = fullSymbol.split(':');
    const exchange = parts.length > 1 ? parts[0].toUpperCase() : 'UNKNOWN';

    // High confidence for major exchanges
    if (['NASDAQ', 'NYSE'].includes(exchange)) {
      confidence += 0.3;
    } else if (exchange === 'AMEX') {
      confidence += 0.15;
    }

    // Type matching boosts confidence
    if (instrumentType === InstrumentType.ETF) {
      if (resultType.includes('fund') || resultType.includes('etf')) {
        confidence += 0.2;
      }
    } else if (instrumentType === InstrumentType.EQUITY) {
      if (resultType.includes('stock') || resultType.includes('equity')) {
        confidence += 0.2;
      }
    }

    return Math.min(confidence, 1.0);
  }

  /**
   * Clear the resolution cache
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.debug('Exchange resolution cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: number } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.entries()).filter(([_, v]) => v !== null).length,
    };
  }
}
