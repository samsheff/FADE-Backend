import crypto from 'node:crypto';
import { getEnvironment } from '../../config/environment.js';
import { getLogger } from '../../utils/logger.js';
import { TradeRepository } from '../../adapters/database/repositories/trade.repository.js';
import { Trade } from '../../types/trade.types.js';

interface ClobTrade {
  id?: string;
  trade_id?: string;
  price: string;
  size: string;
  side: string;
  market?: string;
  condition_id?: string;
  outcome?: string;
  maker_address?: string;
  taker_address?: string;
  owner?: string;
  transaction_hash?: string;
  tx_hash?: string;
  match_time?: string;
  created_at?: string;
}

export class TradeIngestionService {
  private env;
  private logger;
  private tradeRepo: TradeRepository;

  constructor() {
    this.env = getEnvironment();
    this.logger = getLogger();
    this.tradeRepo = new TradeRepository();
  }

  async ingestTradesForWallet(walletAddress: string): Promise<Trade[]> {
    if (!this.hasClobCredentials()) {
      this.logger.warn('CLOB API credentials missing; skipping trade ingestion');
      return [];
    }

    const latest = await this.tradeRepo.findLatestTimestampByWallet(walletAddress);
    const after = latest ? Math.floor(latest.getTime() / 1000) : undefined;

    const makerTrades = await this.fetchTrades({ maker_address: walletAddress, after });
    const takerTrades = await this.fetchTrades({ taker_address: walletAddress, after });

    const allTrades = [...makerTrades, ...takerTrades];
    const inserted: Trade[] = [];

    for (const trade of allTrades) {
      const parsed = this.toTrade(trade, walletAddress);
      if (!parsed) {
        continue;
      }

      const existing = await this.tradeRepo.findById(parsed.id);
      const saved = await this.tradeRepo.upsert(parsed);
      if (!existing) {
        inserted.push(saved);
      }
    }

    return inserted;
  }

  private hasClobCredentials(): boolean {
    return Boolean(
      this.env.POLYMARKET_CLOB_API_KEY &&
        this.env.POLYMARKET_CLOB_API_SECRET &&
        this.env.POLYMARKET_CLOB_API_PASSPHRASE &&
        this.env.POLYMARKET_CLOB_SIGNER_ADDRESS,
    );
  }

  private async fetchTrades(params: {
    maker_address?: string;
    taker_address?: string;
    after?: number;
  }): Promise<ClobTrade[]> {
    const query = new URLSearchParams();
    if (params.maker_address) {
      query.set('maker_address', params.maker_address);
    }
    if (params.taker_address) {
      query.set('taker_address', params.taker_address);
    }
    if (params.after) {
      query.set('after', params.after.toString());
    }

    const path = `/data/trades${query.toString() ? `?${query.toString()}` : ''}`;
    const url = `${this.env.POLYMARKET_CLOB_API_URL}${path}`;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = this.buildClobSignature('GET', path, '', timestamp);

    const response = await fetch(url, {
      headers: {
        'POLY-API-KEY': this.env.POLYMARKET_CLOB_API_KEY!,
        'POLY-PASSPHRASE': this.env.POLYMARKET_CLOB_API_PASSPHRASE!,
        'POLY-SIGNATURE': signature,
        'POLY-TIMESTAMP': timestamp,
        'POLY-ADDRESS': this.env.POLYMARKET_CLOB_SIGNER_ADDRESS!,
      },
    });

    if (!response.ok) {
      this.logger.error(
        { status: response.status, statusText: response.statusText },
        'Failed to fetch trades from CLOB',
      );
      return [];
    }

    const data: { trades?: ClobTrade[]; data?: ClobTrade[] } = await response.json();
    return data.trades || data.data || [];
  }

  private buildClobSignature(method: string, path: string, body: string, timestamp: string): string {
    const payload = `${timestamp}${method.toUpperCase()}${path}${body}`;
    const secret = Buffer.from(this.env.POLYMARKET_CLOB_API_SECRET!, 'base64');
    return crypto.createHmac('sha256', secret).update(payload).digest('base64');
  }

  private toTrade(trade: ClobTrade, walletAddress: string): Trade | null {
    const marketId = trade.market || trade.condition_id;
    if (!marketId || !trade.price || !trade.size) {
      return null;
    }

    const outcome = (trade.outcome || 'YES').toUpperCase() as 'YES' | 'NO';
    const side = trade.side?.toLowerCase() === 'sell' ? 'sell' : 'buy';
    const timestamp = this.parseTimestamp(trade.match_time || trade.created_at);
    const id = trade.id || trade.trade_id || this.hashTrade(trade, marketId);

    return {
      id,
      walletAddress,
      marketId,
      outcome,
      side,
      price: trade.price,
      size: trade.size,
      txHash: trade.transaction_hash || trade.tx_hash || null,
      blockNumber: null,
      gasUsed: null,
      fee: null,
      timestamp,
      confirmedAt: null,
    };
  }

  private parseTimestamp(value?: string): Date {
    if (!value) {
      return new Date();
    }
    if (/^\d+$/.test(value)) {
      const numeric = Number(value);
      const millis = numeric > 1e12 ? numeric : numeric * 1000;
      return new Date(millis);
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  private hashTrade(trade: ClobTrade, marketId: string): string {
    const seed = [
      marketId,
      trade.price,
      trade.size,
      trade.side,
      trade.match_time,
      trade.transaction_hash,
    ]
      .filter(Boolean)
      .join('|');
    return crypto.createHash('sha256').update(seed).digest('hex');
  }
}
