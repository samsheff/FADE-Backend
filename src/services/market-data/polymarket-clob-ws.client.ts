import WebSocket from 'ws';
import { getLogger } from '../../utils/logger.js';
import { NormalizedMarketDataMessage, MarketOutcome } from '../../types/market-data.types.js';

type Subscription = {
  marketId: string;
  outcome: MarketOutcome;
  tokenId?: string;
};

type ClientOptions = {
  url: string;
  heartbeatIntervalMs: number;
  reconnectBaseMs: number;
  reconnectMaxMs: number;
};

type MessageHandler = (message: NormalizedMarketDataMessage) => void;

export class PolymarketCLOBWebSocketClient {
  private options: ClientOptions;
  private ws: WebSocket | null = null;
  private logger = getLogger();
  private subscriptions = new Map<string, Subscription>();
  private tokenIndex = new Map<string, Subscription>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private handler: MessageHandler | null = null;

  constructor(options: ClientOptions) {
    this.options = options;
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  connect(): void {
    if (this.ws) {
      return;
    }

    this.logger.info({ url: this.options.url }, 'Connecting to Polymarket CLOB WebSocket');
    const ws = new WebSocket(this.options.url);
    this.ws = ws;

    ws.on('open', () => {
      this.logger.info('Polymarket CLOB WebSocket connected');
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.resubscribeAll();
    });

    ws.on('message', (data) => {
      this.handleRawMessage(data.toString());
    });

    ws.on('close', (code, reason) => {
      this.logger.warn({ code, reason: reason.toString() }, 'CLOB WebSocket closed');
      this.cleanup();
      this.scheduleReconnect();
    });

    ws.on('error', (error) => {
      this.logger.error({ err: error }, 'CLOB WebSocket error');
      this.cleanup();
      this.scheduleReconnect();
    });

    ws.on('unexpected-response', (_req, res) => {
      this.logger.error(
        { statusCode: res.statusCode, headers: res.headers },
        'CLOB WebSocket unexpected response',
      );
    });
  }

  disconnect(): void {
    if (!this.ws) {
      return;
    }
    this.logger.info('Closing Polymarket CLOB WebSocket');
    this.ws.close();
    this.cleanup();
  }

  subscribe(subscription: Subscription): void {
    const key = this.keyFor(subscription);
    this.subscriptions.set(key, subscription);
    if (subscription.tokenId) {
      this.tokenIndex.set(subscription.tokenId, subscription);
    }
    this.sendSubscribe(subscription);
  }

  unsubscribe(subscription: Subscription): void {
    const key = this.keyFor(subscription);
    this.subscriptions.delete(key);
    if (subscription.tokenId) {
      this.tokenIndex.delete(subscription.tokenId);
    }
    this.sendUnsubscribe(subscription);
  }

  private handleRawMessage(payload: string): void {
    let message: unknown;
    try {
      message = JSON.parse(payload);
    } catch (error) {
      this.logger.warn({ payload }, 'Failed to parse WebSocket payload');
      return;
    }

    const normalized = this.normalizeMessage(message);
    if (!normalized || normalized.length === 0) {
      return;
    }
    normalized.forEach((event) => this.handler?.(event));
  }

  private normalizeMessage(message: unknown): NormalizedMarketDataMessage[] | null {
    if (!message || typeof message !== 'object') {
      return null;
    }
    const record = message as Record<string, unknown>;
    const type = String(record.type || record.event || record.event_type || '');

    const marketId = this.toString(record.market_id || record.condition_id || record.market || record.marketId);
    const assetId = this.toString(record.asset_id || record.token_id || record.assetId);
    const outcome =
      (this.toString(record.outcome) || '').toUpperCase() as MarketOutcome;
    const timestampValue =
      this.toNumber(record.timestamp) ||
      this.toNumber(record.ts) ||
      this.toNumber(record.time);
    const timestamp = timestampValue ? new Date(timestampValue) : new Date();

    const resolvedOutcome =
      outcome || (assetId ? (this.tokenIndex.get(assetId)?.outcome as MarketOutcome) : null);
    const resolvedMarketId =
      marketId || (assetId ? this.tokenIndex.get(assetId)?.marketId : null);

    if (!resolvedMarketId || !resolvedOutcome) {
      return null;
    }

    if (Array.isArray(record.bids) || Array.isArray(record.asks)) {
      const updates = [
        ...this.mapOrderbookSide('bid', record.bids as unknown, resolvedMarketId, resolvedOutcome, timestamp),
        ...this.mapOrderbookSide('ask', record.asks as unknown, resolvedMarketId, resolvedOutcome, timestamp),
      ];

      if (updates.length > 0) {
        return updates;
      }

      const bestBid = this.bestPrice(record.bids as unknown);
      const bestAsk = this.bestPrice(record.asks as unknown);
      const midPrice =
        bestBid && bestAsk
          ? ((Number(bestBid) + Number(bestAsk)) / 2).toString()
          : null;

      return [
        {
          type: 'orderbook_update',
          marketId: resolvedMarketId,
          outcome: resolvedOutcome,
          bestBid,
          bestAsk,
          midPrice,
          timestamp,
        },
      ];
    }

    if (record.event_type === 'book' && (Array.isArray(record.buys) || Array.isArray(record.sells))) {
      const updates = [
        ...this.mapOrderbookSide('bid', record.buys as unknown, resolvedMarketId, resolvedOutcome, timestamp),
        ...this.mapOrderbookSide('ask', record.sells as unknown, resolvedMarketId, resolvedOutcome, timestamp),
      ];
      if (updates.length === 0) {
        return null;
      }
      updates[0].snapshot = 'start';
      updates[updates.length - 1].snapshot = 'end';
      return updates;
    }

    if (record.best_bid || record.best_ask || type === 'price') {
      const bestBid = this.toString(record.best_bid || record.bestBid);
      const bestAsk = this.toString(record.best_ask || record.bestAsk);
      const midPrice =
        bestBid && bestAsk
          ? ((Number(bestBid) + Number(bestAsk)) / 2).toString()
          : this.toString(record.mid_price || record.midPrice || record.price);

      return [
        {
          type: 'price_update',
          marketId: resolvedMarketId,
          outcome: resolvedOutcome,
          bestBid: bestBid || undefined,
          bestAsk: bestAsk || undefined,
          midPrice: midPrice || undefined,
          timestamp,
        },
      ];
    }

    if (type === 'trade' || record.trade_id || record.size) {
      const price = this.toString(record.price);
      const size = this.toString(record.size);
      if (!price || !size) {
        return null;
      }
      return [
        {
          type: 'trade',
          marketId: resolvedMarketId,
          outcome: resolvedOutcome,
          price,
          size,
          timestamp,
        },
      ];
    }

    return null;
  }

  private mapOrderbookSide(
    side: 'bid' | 'ask',
    levels: unknown,
    marketId: string,
    outcome: MarketOutcome,
    timestamp: Date,
  ): NormalizedMarketDataMessage[] {
    if (!Array.isArray(levels)) {
      return [];
    }

    const updates: NormalizedMarketDataMessage[] = [];
    for (const level of levels) {
      if (Array.isArray(level) && level.length >= 2) {
        const price = this.toString(level[0]);
        const size = this.toString(level[1]);
        if (price && size) {
          updates.push({
            type: 'orderbook_update',
            marketId,
            outcome,
            side,
            price,
            size,
            timestamp,
          });
        }
        continue;
      }
      if (level && typeof level === 'object') {
        const record = level as Record<string, unknown>;
        const price = this.toString(record.price);
        const size = this.toString(record.size);
        if (price && size) {
          updates.push({
            type: 'orderbook_update',
            marketId,
            outcome,
            side,
            price,
            size,
            timestamp,
          });
        }
      }
    }
    return updates;
  }

  private bestPrice(side: unknown): string | null {
    if (!Array.isArray(side)) {
      return null;
    }
    const first = side[0] as unknown;
    if (Array.isArray(first) && first.length > 0) {
      return this.toString(first[0]) || null;
    }
    if (first && typeof first === 'object') {
      const record = first as Record<string, unknown>;
      return this.toString(record.price) || null;
    }
    return null;
  }

  private toString(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number') {
      return value.toString();
    }
    return null;
  }

  private toNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      const num = Number(value);
      return Number.isNaN(num) ? null : num;
    }
    return null;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, this.options.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }
    const delay = Math.min(
      this.options.reconnectBaseMs * 2 ** this.reconnectAttempts,
      this.options.reconnectMaxMs,
    );
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private cleanup(): void {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws = null;
    }
  }

  private resubscribeAll(): void {
    for (const subscription of this.subscriptions.values()) {
      this.sendSubscribe(subscription);
    }
  }

  private sendSubscribe(subscription: Subscription): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    if (!subscription.tokenId) {
      return;
    }
    const payload = {
      type: 'market',
      assets_ids: [subscription.tokenId],
    };
    this.ws.send(JSON.stringify(payload));
  }

  private sendUnsubscribe(subscription: Subscription): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    if (!subscription.tokenId) {
      return;
    }
    const payload = {
      operation: 'unsubscribe',
      assets_ids: [subscription.tokenId],
    };
    this.ws.send(JSON.stringify(payload));
  }

  private keyFor(subscription: Subscription): string {
    return `${subscription.marketId}:${subscription.outcome}`;
  }
}
