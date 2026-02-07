import { FilingRepository } from '../../adapters/database/repositories/filing.repository.js';
import {
  FilingRecord,
  FilingContentRecord,
  FilingFactRecord,
  FilingFilters,
} from '../../types/edgar.types.js';

/**
 * Filing Service
 * Business logic for filing-related operations
 */
export class FilingService {
  private filingRepo: FilingRepository;

  constructor() {
    this.filingRepo = new FilingRepository();
  }

  /**
   * Get filing by ID
   */
  async getFilingById(id: string): Promise<FilingRecord | null> {
    return this.filingRepo.findById(id);
  }

  /**
   * Get filing content
   */
  async getFilingContent(filingId: string): Promise<FilingContentRecord | null> {
    return this.filingRepo.findContentByFilingId(filingId);
  }

  /**
   * Get filing facts
   */
  async getFilingFacts(filingId: string): Promise<FilingFactRecord[]> {
    return this.filingRepo.findFactsByFilingId(filingId);
  }

  /**
   * Find filings with filters
   */
  async findFilings(filters: FilingFilters): Promise<{
    filings: FilingRecord[];
    total: number;
  }> {
    return this.filingRepo.findMany(filters);
  }

  /**
   * Get filings by CIK
   */
  async getFilingsByCik(
    cik: string,
    filters?: FilingFilters,
  ): Promise<{
    filings: FilingRecord[];
    total: number;
  }> {
    return this.filingRepo.findByCik(cik, filters);
  }

  /**
   * Get filing statistics
   */
  async getFilingStatistics(): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
  }> {
    // This would need aggregation queries
    // For now, return placeholder
    return {
      total: 0,
      byStatus: {},
      byType: {},
    };
  }
}
