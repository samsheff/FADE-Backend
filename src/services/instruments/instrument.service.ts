import { InstrumentRepository } from '../../adapters/database/repositories/instrument.repository.js';
import { SignalRepository } from '../../adapters/database/repositories/signal.repository.js';
import { FilingRepository } from '../../adapters/database/repositories/filing.repository.js';
import { InstrumentFilters, InstrumentRecord } from '../../types/instrument.types.js';
import { SignalRecord } from '../../types/edgar.types.js';

/**
 * Instrument Service
 * Business logic for instrument-related operations
 */
export class InstrumentService {
  private instrumentRepo: InstrumentRepository;
  private signalRepo: SignalRepository;
  private filingRepo: FilingRepository;

  constructor() {
    this.instrumentRepo = new InstrumentRepository();
    this.signalRepo = new SignalRepository();
    this.filingRepo = new FilingRepository();
  }

  /**
   * Find instruments with optional filters
   */
  async findInstruments(filters: InstrumentFilters): Promise<{
    instruments: InstrumentRecord[];
    total: number;
  }> {
    return this.instrumentRepo.findMany(filters);
  }

  /**
   * Get instrument by ID
   */
  async getInstrumentById(id: string): Promise<InstrumentRecord | null> {
    return this.instrumentRepo.findById(id);
  }

  /**
   * Get instrument by CIK
   */
  async getInstrumentByCik(cik: string): Promise<InstrumentRecord | null> {
    return this.instrumentRepo.findByCik(cik);
  }

  /**
   * Get signals for an instrument
   */
  async getSignalsForInstrument(instrumentId: string): Promise<SignalRecord[]> {
    return this.signalRepo.findByInstrument(instrumentId);
  }

  /**
   * Get filings for an instrument (via CIK lookup)
   */
  async getFilingsForInstrument(instrumentId: string): Promise<{
    filings: any[];
    total: number;
  }> {
    const instrument = await this.instrumentRepo.findById(instrumentId);

    if (!instrument) {
      return { filings: [], total: 0 };
    }

    // Get CIK from identifiers
    // Note: We'd need to load identifiers from the instrument
    // For now, assume we can get CIK from a dedicated method
    const cik = await this.getCikForInstrument(instrumentId);

    if (!cik) {
      return { filings: [], total: 0 };
    }

    return this.filingRepo.findByCik(cik);
  }

  /**
   * Helper: Get CIK for instrument
   */
  private async getCikForInstrument(_instrumentId: string): Promise<string | null> {
    // This would need to query instrument_identifiers table
    // For now, simplified implementation
    // instrument lookup not needed

    // In a full implementation, we'd join with identifiers
    // For now, return null and handle in the repo layer
    return null;
  }
}
