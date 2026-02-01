export interface Market {
  id: string;
  question: string;
  outcomes: string[];
  expiryDate: Date;
  liquidity: string;
  volume24h: string;
  categoryTag: string | null;
  marketSlug: string;
  active: boolean;
  tokens: Record<string, string>; // outcome -> token address
  createdAt: Date;
  lastUpdated: Date;
}

export interface OrderbookLevel {
  price: string;
  size: string;
}

export interface Orderbook {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
}

export interface OrderbookSnapshot {
  marketId: string;
  outcome: string;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  timestamp: Date;
  expiresAt: Date;
}

export interface MarketFilters {
  active?: boolean;
  category?: string;
  limit?: number;
  offset?: number;
}

export interface MarketListResponse {
  markets: Market[];
  total: number;
}
