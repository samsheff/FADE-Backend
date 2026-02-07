export type MarketOutcome = 'YES' | 'NO';

export type MarketDataMessageType = 'orderbook_update' | 'price_update' | 'trade';

export interface NormalizedMarketDataMessage {
  type: MarketDataMessageType;
  marketId: string;
  outcome: MarketOutcome;
  side?: 'bid' | 'ask';
  snapshot?: 'start' | 'end';
  price?: string;
  size?: string;
  bestBid?: string;
  bestAsk?: string;
  midPrice?: string;
  timestamp: Date;
}

export interface OrderbookEventRecord {
  id?: string;
  marketId: string;
  outcome: MarketOutcome;
  bestBid: string | null;
  bestAsk: string | null;
  midPrice: string | null;
  timestamp: Date;
}

export interface TradeEventRecord {
  id?: string;
  marketId: string;
  outcome: MarketOutcome;
  price: string;
  size: string;
  timestamp: Date;
}

export type CandleInterval = '1s' | '5s' | '1m' | '5m' | '15m' | '1h';

export interface Candle {
  marketId: string;
  outcome: MarketOutcome;
  interval: CandleInterval;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string | null;
  startTime: Date;
  endTime: Date;
}
