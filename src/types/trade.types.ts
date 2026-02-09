export type Outcome = 'YES' | 'NO';
export type TradeSide = 'buy' | 'sell';

export interface Trade {
  id: string;
  walletAddress: string;
  marketId: string;
  outcome: Outcome;
  side: TradeSide;
  price: string;
  size: string;
  txHash: string | null;
  blockNumber: bigint | null;
  gasUsed: bigint | null;
  fee: string | null;
  timestamp: Date;
  confirmedAt: Date | null;
}

export interface PrepareTradeRequest {
  marketId: string;
  outcome: Outcome;
  side: TradeSide;
  size: string;
  orderType?: 'market' | 'limit'; // Default: 'market' (backward compatible)
  limitPrice?: string;             // Required when orderType === 'limit'
}

export interface UnsignedTransaction {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
  chainId: number;
  gasLimit: bigint;
}

export interface PrepareTradeResponse {
  unsignedTx: UnsignedTransaction;
  estimatedCost: string;
  slippageEstimate: string;
}
