import { EventEmitter } from 'node:events';
import { NormalizedMarketDataMessage } from '../../types/market-data.types.js';

type MarketEvent = NormalizedMarketDataMessage;

export class MarketDataPubSub {
  private emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(200);
  }

  publish(channel: string, event: MarketEvent): void {
    this.emitter.emit(channel, event);
  }

  subscribe(channel: string, listener: (event: MarketEvent) => void): () => void {
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.off(channel, listener);
    };
  }
}
