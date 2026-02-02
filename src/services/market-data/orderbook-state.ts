type Side = 'bid' | 'ask';

export class OrderbookState {
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();
  private bestBid: number | null = null;
  private bestAsk: number | null = null;

  seed(bids: Array<{ price: string; size: string }>, asks: Array<{ price: string; size: string }>): void {
    this.bids.clear();
    this.asks.clear();
    bids.forEach((level) => this.setLevel('bid', level.price, level.size));
    asks.forEach((level) => this.setLevel('ask', level.price, level.size));
    this.bestBid = this.findBest('bid');
    this.bestAsk = this.findBest('ask');
  }

  applyDelta(side: Side, price: string, size: string): void {
    this.setLevel(side, price, size);
    const numericPrice = Number(price);
    if (Number.isNaN(numericPrice)) {
      return;
    }
    const best = side === 'bid' ? this.bestBid : this.bestAsk;
    if (size === '0' || Number(size) === 0) {
      if (best === numericPrice) {
        if (side === 'bid') {
          this.bestBid = this.findBest('bid');
        } else {
          this.bestAsk = this.findBest('ask');
        }
      }
      return;
    }
    if (best === null) {
      if (side === 'bid') {
        this.bestBid = numericPrice;
      } else {
        this.bestAsk = numericPrice;
      }
      return;
    }

    if (side === 'bid' && numericPrice > best) {
      this.bestBid = numericPrice;
    }
    if (side === 'ask' && numericPrice < best) {
      this.bestAsk = numericPrice;
    }
  }

  getBestBid(): string | null {
    return this.bestBid === null ? null : this.bestBid.toString();
  }

  getBestAsk(): string | null {
    return this.bestAsk === null ? null : this.bestAsk.toString();
  }

  getMidPrice(): string | null {
    if (this.bestBid === null || this.bestAsk === null) {
      return null;
    }
    return ((this.bestBid + this.bestAsk) / 2).toString();
  }

  getFullBids(): Array<{ price: string; size: string }> {
    return Array.from(this.bids.entries())
      .sort((a, b) => b[0] - a[0]) // Descending
      .map(([price, size]) => ({
        price: price.toString(),
        size: size.toString(),
      }));
  }

  getFullAsks(): Array<{ price: string; size: string }> {
    return Array.from(this.asks.entries())
      .sort((a, b) => a[0] - b[0]) // Ascending
      .map(([price, size]) => ({
        price: price.toString(),
        size: size.toString(),
      }));
  }

  private setLevel(side: Side, price: string, size: string): void {
    const numericPrice = Number(price);
    const numericSize = Number(size);
    if (Number.isNaN(numericPrice)) {
      return;
    }
    const map = side === 'bid' ? this.bids : this.asks;
    if (Number.isNaN(numericSize) || numericSize <= 0) {
      map.delete(numericPrice);
      return;
    }
    map.set(numericPrice, numericSize);
  }

  private findBest(side: Side): number | null {
    const map = side === 'bid' ? this.bids : this.asks;
    if (map.size === 0) {
      return null;
    }
    let best: number | null = null;
    for (const price of map.keys()) {
      if (best === null) {
        best = price;
      } else if (side === 'bid' && price > best) {
        best = price;
      } else if (side === 'ask' && price < best) {
        best = price;
      }
    }
    return best;
  }
}
