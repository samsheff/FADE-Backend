import { isAddress } from 'viem';
import { ValidationError } from './errors.js';

export function validateAddress(address: string): `0x${string}` {
  if (!isAddress(address)) {
    throw new ValidationError(`Invalid Ethereum address: ${address}`);
  }
  return address as `0x${string}`;
}

export function validatePrice(price: number): void {
  if (price < 0 || price > 1) {
    throw new ValidationError('Price must be between 0 and 1');
  }
}

export function validateSize(size: string): void {
  const sizeNum = parseFloat(size);
  if (isNaN(sizeNum) || sizeNum <= 0) {
    throw new ValidationError('Size must be a positive number');
  }
}

export function validateOutcome(outcome: string): 'YES' | 'NO' {
  const upper = outcome.toUpperCase();
  if (upper !== 'YES' && upper !== 'NO') {
    throw new ValidationError('Outcome must be YES or NO');
  }
  return upper as 'YES' | 'NO';
}

export function validateSide(side: string): 'buy' | 'sell' {
  const lower = side.toLowerCase();
  if (lower !== 'buy' && lower !== 'sell') {
    throw new ValidationError('Side must be buy or sell');
  }
  return lower as 'buy' | 'sell';
}

export function validateMarketId(marketId: string): void {
  if (!marketId || marketId.trim().length === 0) {
    throw new ValidationError('Market ID is required');
  }
}

export function validatePagination(limit?: number, offset?: number): {
  limit: number;
  offset: number;
} {
  const validatedLimit = limit && limit > 0 && limit <= 100 ? limit : 20;
  const validatedOffset = offset && offset >= 0 ? offset : 0;
  return { limit: validatedLimit, offset: validatedOffset };
}
