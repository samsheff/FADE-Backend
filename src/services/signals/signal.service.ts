import { SignalRepository } from '../../adapters/database/repositories/signal.repository.js';
import { InstrumentRepository } from '../../adapters/database/repositories/instrument.repository.js';
import { SignalRecord, SignalFilters, SignalType, SignalSeverity } from '../../types/edgar.types.js';

/**
 * Signal Service
 * Business logic for signal-related operations
 */
export class SignalService {
  private signalRepo: SignalRepository;
  private instrumentRepo: InstrumentRepository;

  constructor() {
    this.signalRepo = new SignalRepository();
    this.instrumentRepo = new InstrumentRepository();
  }

  /**
   * Find signals with filters
   */
  async findSignals(filters: SignalFilters): Promise<{
    signals: SignalRecord[];
    instruments: Record<string, any>;
    total: number;
  }> {
    const { signals, total } = await this.signalRepo.findActiveSignals(filters);

    // Load associated instruments
    const instrumentIds = [...new Set(signals.map((s) => s.instrumentId))];
    const instruments: Record<string, any> = {};

    for (const id of instrumentIds) {
      const instrument = await this.instrumentRepo.findById(id);
      if (instrument) {
        instruments[id] = instrument;
      }
    }

    return { signals, instruments, total };
  }

  /**
   * Get toxic financing candidates
   * Returns instruments with TOXIC_FINANCING_RISK signals at HIGH or CRITICAL severity
   */
  async getToxicFinancingCandidates(): Promise<{
    signals: SignalRecord[];
    instruments: Record<string, any>;
  }> {
    const signals = await this.signalRepo.findByType(
      SignalType.TOXIC_FINANCING_RISK,
      SignalSeverity.HIGH,
    );

    // Load associated instruments
    const instrumentIds = [...new Set(signals.map((s) => s.instrumentId))];
    const instruments: Record<string, any> = {};

    for (const id of instrumentIds) {
      const instrument = await this.instrumentRepo.findById(id);
      if (instrument) {
        instruments[id] = instrument;
      }
    }

    return { signals, instruments };
  }

  /**
   * Get dilution risk candidates
   * Returns instruments with DILUTION_RISK signals at HIGH or CRITICAL severity
   */
  async getDilutionRiskCandidates(): Promise<{
    signals: SignalRecord[];
    instruments: Record<string, any>;
  }> {
    const signals = await this.signalRepo.findByType(
      SignalType.DILUTION_RISK,
      SignalSeverity.HIGH,
    );

    // Load associated instruments
    const instrumentIds = [...new Set(signals.map((s) => s.instrumentId))];
    const instruments: Record<string, any> = {};

    for (const id of instrumentIds) {
      const instrument = await this.instrumentRepo.findById(id);
      if (instrument) {
        instruments[id] = instrument;
      }
    }

    return { signals, instruments };
  }

  /**
   * Get distress risk candidates
   */
  async getDistressRiskCandidates(): Promise<{
    signals: SignalRecord[];
    instruments: Record<string, any>;
  }> {
    const signals = await this.signalRepo.findByType(
      SignalType.DISTRESS_RISK,
      SignalSeverity.MEDIUM,
    );

    const instrumentIds = [...new Set(signals.map((s) => s.instrumentId))];
    const instruments: Record<string, any> = {};

    for (const id of instrumentIds) {
      const instrument = await this.instrumentRepo.findById(id);
      if (instrument) {
        instruments[id] = instrument;
      }
    }

    return { signals, instruments };
  }

  /**
   * Get signal statistics
   */
  async getSignalStatistics(): Promise<{
    counts: Record<SignalType, Record<SignalSeverity, number>>;
    total: number;
  }> {
    const counts = await this.signalRepo.getSignalCounts();

    const total = Object.values(counts).reduce(
      (sum, severities) =>
        sum + Object.values(severities).reduce((s, count) => s + count, 0),
      0,
    );

    return { counts, total };
  }
}
