/**
 * ETF Detection Utility
 *
 * Detects whether a ticker symbol represents an ETF based on:
 * - Known ETF issuers
 * - Name patterns
 * - Ticker patterns
 */

export interface EtfDetectionResult {
  isEtf: boolean;
  confidence: number;
  reason: string;
}

export class EtfDetector {
  private static readonly ETF_ISSUERS = [
    'BLACKROCK',
    'VANGUARD',
    'STATE STREET',
    'SPDR',
    'INVESCO',
    'ISHARES',
    'WISDOMTREE',
    'PROSHARES',
    'DIREXION',
    'FIRST TRUST',
    'VANECK',
    'GLOBAL X',
    'ARK INVEST',
    'PIMCO',
    'SCHWAB',
  ];

  private static readonly ETF_NAME_PATTERNS = [
    /\bETF\b/i,
    /EXCHANGE[- ]TRADED/i,
    /INDEX FUND/i,
    /TRUST SERIES/i,
    /SHARES TRUST/i,
    /FUND TRUST/i,
  ];

  /**
   * Detect if a ticker represents an ETF
   */
  static detectEtf(ticker: string, name: string): EtfDetectionResult {
    const upperName = name.toUpperCase();
    const upperTicker = ticker.toUpperCase();

    // Check for known ETF issuers in the name
    const issuerMatch = this.ETF_ISSUERS.some(issuer => upperName.includes(issuer));
    if (issuerMatch) {
      return {
        isEtf: true,
        confidence: 0.95,
        reason: 'Known ETF issuer in name',
      };
    }

    // Check for ETF name patterns
    const patternMatch = this.ETF_NAME_PATTERNS.some(pattern => pattern.test(name));
    if (patternMatch) {
      return {
        isEtf: true,
        confidence: 0.9,
        reason: 'ETF keyword in name',
      };
    }

    // Check for ticker patterns (3-letter tickers are common for ETFs)
    if (upperTicker.length === 3 && /^[A-Z]+$/.test(upperTicker)) {
      // Common 3-letter ETFs: SPY, QQQ, IWM, DIA, VTI, VOO, etc.
      const commonEtfs = ['SPY', 'QQQ', 'IWM', 'DIA', 'VTI', 'VOO', 'VEA', 'VWO', 'AGG', 'BND'];
      if (commonEtfs.includes(upperTicker)) {
        return {
          isEtf: true,
          confidence: 0.99,
          reason: 'Known major ETF ticker',
        };
      }

      // 3-letter tickers have moderate ETF likelihood
      return {
        isEtf: false,
        confidence: 0.3,
        reason: '3-letter ticker (moderate ETF probability)',
      };
    }

    // Check for Q prefix (common for NASDAQ ETFs)
    if (upperTicker.startsWith('Q') && upperTicker.length === 4) {
      return {
        isEtf: false,
        confidence: 0.4,
        reason: 'Q-prefix ticker (some ETF probability)',
      };
    }

    // Default: likely not an ETF
    return {
      isEtf: false,
      confidence: 0.1,
      reason: 'No ETF indicators found',
    };
  }
}
