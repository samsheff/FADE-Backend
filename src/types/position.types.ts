import { Outcome } from './trade.types.js';

export interface Position {
  walletAddress: string;
  marketId: string;
  outcome: Outcome;
  avgPrice: string;
  size: string;
  realizedPnl: string;
  unrealizedPnl: string;
  lastTradeAt: Date;
  updatedAt: Date;
}

export interface PositionListResponse {
  positions: Position[];
  totalPnl: string;
}
