import { UnsignedTransaction } from '../../types/trade.types.js';

export interface BlockchainAdapter {
  getBalance(address: `0x${string}`, tokenAddress?: `0x${string}`): Promise<bigint>;
  getCurrentBlock(): Promise<bigint>;
  readContract<T>(params: {
    address: `0x${string}`;
    abi: unknown[];
    functionName: string;
    args?: unknown[];
  }): Promise<T>;
  prepareTransaction(params: {
    to: `0x${string}`;
    data: `0x${string}`;
    value?: bigint;
  }): Promise<UnsignedTransaction>;
  estimateGas(params: {
    to: `0x${string}`;
    data: `0x${string}`;
    value?: bigint;
    from?: `0x${string}`;
  }): Promise<bigint>;
  isValidAddress(address: string): boolean;
}
