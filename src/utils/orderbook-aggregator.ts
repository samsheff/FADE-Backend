export interface PriceLevel {
  price: string;
  size: string;
}

export function aggregateOrderbookDepth(
  levels: PriceLevel[],
  bucketSize: number = 0.01,
): PriceLevel[] {
  const buckets = new Map<number, number>();

  for (const level of levels) {
    const price = Number(level.price);
    const size = Number(level.size);

    if (isNaN(price) || isNaN(size)) continue;

    const bucketPrice = Math.floor(price / bucketSize) * bucketSize;
    buckets.set(bucketPrice, (buckets.get(bucketPrice) || 0) + size);
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([price, size]) => ({
      price: price.toFixed(2),
      size: size.toString(),
    }));
}
