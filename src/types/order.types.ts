export type OrderType = 'market' | 'limit';
export type InstrumentType = 'polymarket' | 'equity';

export interface OrderIntent {
  instrumentType: InstrumentType;
  instrumentId: string;
  orderType: OrderType;
  size: string;
  limitPrice?: string; // Required for limit orders
}

export interface PolyMarketOrderIntent extends OrderIntent {
  instrumentType: 'polymarket';
  instrumentId: string; // marketId
  outcome: 'YES' | 'NO';
  side: 'buy' | 'sell';
}

export interface EquityOrderIntent extends OrderIntent {
  instrumentType: 'equity';
  instrumentId: string; // symbol or tickerId
  side: 'buy' | 'sell';
}
