import { Decimal } from '@prisma/client/runtime/library';
import { FilingRecord, FilingStatus } from '../../types/edgar.types.js';
import { FilingRepository } from '../../adapters/database/repositories/filing.repository.js';
import { EtfMetricsRepository } from '../../adapters/database/repositories/etf-metrics.repository.js';
import { EtfApDetailRepository } from '../../adapters/database/repositories/etf-ap-detail.repository.js';
import { CreateEtfMetricsInput, CreateEtfApDetailInput, NPortHolding } from '../../types/etf.types.js';
import { getLogger } from '../../utils/logger.js';
import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../adapters/database/client.js';

/**
 * Service for extracting ETF metrics from N-CEN and N-PORT filings
 */
export class EtfMetricsExtractionService {
  private filingRepo: FilingRepository;
  private etfMetricsRepo: EtfMetricsRepository;
  private etfApRepo: EtfApDetailRepository;
  private logger;

  constructor(prisma?: PrismaClient) {
    const client = prisma || getPrismaClient();
    this.filingRepo = new FilingRepository();
    this.etfMetricsRepo = new EtfMetricsRepository(client);
    this.etfApRepo = new EtfApDetailRepository(client);
    this.logger = getLogger().child({ service: 'EtfMetricsExtraction' });
  }

  /**
   * Extract metrics from N-CEN filing (annual ETF report)
   */
  async extractMetricsFromNCEN(
    filing: FilingRecord,
    instrumentId: string
  ): Promise<CreateEtfMetricsInput | null> {
    try {
      const content = await this.filingRepo.getContent(filing.id);
      if (!content || !content.sections) {
        this.logger.warn({ filingId: filing.id }, 'No sections found in N-CEN filing');
        return null;
      }

      const sections = content.sections as Record<string, string>;
      const fullText = content.fullText;

      const metrics: CreateEtfMetricsInput = {
        instrumentId,
        asOfDate: filing.reportDate || filing.filingDate,
        sourceType: 'N-CEN',
        filingId: filing.id,
      };

      // Extract authorized participant count from "Authorized Participants" section
      const apSection = sections['Authorized Participants'];
      if (apSection) {
        const apCount = this.extractApCount(apSection);
        if (apCount !== null) {
          metrics.activeApCount = apCount;
        }
      }

      // Extract creation/redemption data
      const creationRedemptionData = this.extractCreationRedemptionData(fullText);
      if (creationRedemptionData) {
        metrics.creationUnits = creationRedemptionData.creationUnits;
        metrics.redemptionUnits = creationRedemptionData.redemptionUnits;
        metrics.netFlowUnits = new Decimal(
          Number(creationRedemptionData.creationUnits || 0) -
          Number(creationRedemptionData.redemptionUnits || 0)
        );
      }

      return metrics;
    } catch (error) {
      this.logger.error({ filingId: filing.id, error }, 'Failed to extract N-CEN metrics');
      return null;
    }
  }

  /**
   * Extract metrics from N-PORT filing (quarterly holdings report)
   */
  async extractMetricsFromNPORT(
    filing: FilingRecord,
    instrumentId: string
  ): Promise<CreateEtfMetricsInput | null> {
    try {
      const content = await this.filingRepo.getContent(filing.id);
      if (!content) {
        this.logger.warn({ filingId: filing.id }, 'No content found in N-PORT filing');
        return null;
      }

      const fullText = content.fullText;

      const metrics: CreateEtfMetricsInput = {
        instrumentId,
        asOfDate: filing.reportDate || filing.filingDate,
        sourceType: 'N-PORT',
        filingId: filing.id,
      };

      // Extract NAV from holdings
      const nav = this.extractNavFromHoldings(fullText);
      if (nav) {
        metrics.nav = nav;
      }

      return metrics;
    } catch (error) {
      this.logger.error({ filingId: filing.id, error }, 'Failed to extract N-PORT metrics');
      return null;
    }
  }

  /**
   * Extract authorized participant list from N-CEN filing
   */
  async extractApListFromNCEN(
    filing: FilingRecord,
    instrumentId: string
  ): Promise<CreateEtfApDetailInput[]> {
    try {
      const content = await this.filingRepo.getContent(filing.id);
      if (!content || !content.sections) {
        return [];
      }

      const sections = content.sections as Record<string, string>;
      const apSection = sections['Authorized Participants'];
      if (!apSection) {
        return [];
      }

      const apList = this.parseApList(apSection);
      const asOfDate = filing.reportDate || filing.filingDate;

      return apList.map((ap) => ({
        instrumentId,
        filingId: filing.id,
        apName: ap.name,
        apIdentifier: ap.identifier || null,
        shareOfActivity: ap.share ? new Decimal(ap.share) : null,
        isActive: true,
        asOfDate,
      }));
    } catch (error) {
      this.logger.error({ filingId: filing.id, error }, 'Failed to extract AP list from N-CEN');
      return [];
    }
  }

  /**
   * Calculate Herfindahl-Hirschman Index from AP shares
   */
  calculateHHI(apShares: number[]): Decimal {
    if (apShares.length === 0) return new Decimal(0);

    const total = apShares.reduce((sum, share) => sum + share, 0);
    if (total === 0) return new Decimal(0);

    // Normalize shares to percentages (0-100)
    const percentages = apShares.map((share) => (share / total) * 100);

    // HHI = sum of squared market shares
    const hhi = percentages.reduce((sum, pct) => sum + pct * pct, 0);

    return new Decimal(hhi);
  }

  /**
   * Extract NAV from N-PORT holdings data
   */
  private extractNavFromHoldings(fullText: string): Decimal | null {
    try {
      // Look for NAV disclosure in text
      const navPattern = /Net Asset Value.*?[\$]?([\d,]+\.?\d*)/i;
      const match = fullText.match(navPattern);

      if (match && match[1]) {
        const navValue = parseFloat(match[1].replace(/,/g, ''));
        if (!isNaN(navValue) && navValue > 0) {
          return new Decimal(navValue);
        }
      }

      // Try to calculate from holdings XML if available
      const holdings = this.parseNPortHoldings(fullText);
      if (holdings.length > 0) {
        return this.calculateNavFromHoldings(holdings);
      }

      return null;
    } catch (error) {
      this.logger.error({ error }, 'Failed to extract NAV from holdings');
      return null;
    }
  }

  /**
   * Calculate NAV from parsed holdings
   */
  calculateNavFromHoldings(holdings: NPortHolding[]): Decimal {
    let totalValue = new Decimal(0);

    for (const holding of holdings) {
      totalValue = totalValue.plus(holding.value);
    }

    return totalValue;
  }

  /**
   * Parse N-PORT holdings from XML
   */
  private parseNPortHoldings(fullText: string): NPortHolding[] {
    const holdings: NPortHolding[] = [];

    // Simple XML parsing - look for invstOrSec elements
    const holdingPattern = /<invstOrSec>[\s\S]*?<\/invstOrSec>/gi;
    const holdingMatches = fullText.match(holdingPattern);

    if (!holdingMatches) return holdings;

    for (const holdingXml of holdingMatches.slice(0, 100)) { // Limit to first 100
      const holding = this.parseHoldingXml(holdingXml);
      if (holding) {
        holdings.push(holding);
      }
    }

    return holdings;
  }

  /**
   * Parse a single holding XML element
   */
  private parseHoldingXml(xml: string): NPortHolding | null {
    try {
      const name = this.extractXmlTag(xml, 'name') || 'Unknown';
      const cusip = this.extractXmlTag(xml, 'cusip');
      const shares = this.extractXmlTag(xml, 'balance');
      const price = this.extractXmlTag(xml, 'curCd'); // This might need adjustment
      const value = this.extractXmlTag(xml, 'valUSD');

      if (value) {
        return {
          name,
          cusip: cusip || undefined,
          shares: shares ? new Decimal(shares) : new Decimal(0),
          price: price ? new Decimal(price) : new Decimal(0),
          value: new Decimal(value),
        };
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract XML tag value
   */
  private extractXmlTag(xml: string, tagName: string): string | null {
    const pattern = new RegExp(`<${tagName}>([^<]+)<\/${tagName}>`, 'i');
    const match = xml.match(pattern);
    return match ? match[1].trim() : null;
  }

  /**
   * Extract AP count from section text
   */
  private extractApCount(text: string): number | null {
    // Look for patterns like "5 authorized participants" or "There are 3 APs"
    const patterns = [
      /(\d+)\s+authorized\s+participants?/i,
      /authorized\s+participants?.*?(\d+)/i,
      /APs?.*?(\d+)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const count = parseInt(match[1], 10);
        if (!isNaN(count) && count > 0) {
          return count;
        }
      }
    }

    return null;
  }

  /**
   * Parse AP list from section text
   */
  private parseApList(text: string): Array<{ name: string; identifier?: string; share?: number }> {
    const apList: Array<{ name: string; identifier?: string; share?: number }> = [];

    // Look for lines with company names (common AP patterns)
    const lines = text.split('\n');
    const apNamePatterns = [
      /([A-Z][A-Za-z\s&,\.]+(?:LLC|Inc\.|Corporation|Limited|LP|LLP))/,
      /(?:•|-|\d+\.)\s*([A-Z][A-Za-z\s&,\.]+(?:LLC|Inc\.|Corporation|Limited|LP|LLP))/,
    ];

    for (const line of lines) {
      for (const pattern of apNamePatterns) {
        const match = line.match(pattern);
        if (match && match[1]) {
          const name = match[1].trim();
          if (name.length > 3 && !apList.find((ap) => ap.name === name)) {
            apList.push({ name });
          }
        }
      }
    }

    return apList;
  }

  /**
   * Extract creation/redemption data
   */
  private extractCreationRedemptionData(
    text: string
  ): { creationUnits: Decimal | null; redemptionUnits: Decimal | null } | null {
    try {
      const creationPattern = /Creation.*?([\d,]+)\s*(?:units?|shares?)/i;
      const redemptionPattern = /Redemption.*?([\d,]+)\s*(?:units?|shares?)/i;

      const creationMatch = text.match(creationPattern);
      const redemptionMatch = text.match(redemptionPattern);

      if (!creationMatch && !redemptionMatch) return null;

      return {
        creationUnits: creationMatch
          ? new Decimal(creationMatch[1].replace(/,/g, ''))
          : null,
        redemptionUnits: redemptionMatch
          ? new Decimal(redemptionMatch[1].replace(/,/g, ''))
          : null,
      };
    } catch (error) {
      return null;
    }
  }
}
