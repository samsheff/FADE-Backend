import { formatUnits, parseUnits } from 'viem';

const USDC_DECIMALS = 6;

export function formatUSDC(amount: bigint): string {
  return formatUnits(amount, USDC_DECIMALS);
}

export function parseUSDC(amount: string): bigint {
  return parseUnits(amount, USDC_DECIMALS);
}

export function formatPrice(price: number): string {
  return price.toFixed(4);
}

export function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

export function formatTimestamp(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export function parseTimestamp(timestamp: number): Date {
  return new Date(timestamp * 1000);
}
