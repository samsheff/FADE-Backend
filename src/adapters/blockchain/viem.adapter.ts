import { createPublicClient, http, isAddress, parseAbi } from 'viem';
import { polygon } from 'viem/chains';
import { getEnvironment } from '../../config/environment.js';
import { ERC20_ABI } from '../../config/constants.js';
import { BlockchainError } from '../../utils/errors.js';
import { UnsignedTransaction } from '../../types/trade.types.js';
import { BlockchainAdapter } from './blockchain.adapter.js';
import { getLogger } from '../../utils/logger.js';

export class ViemAdapter implements BlockchainAdapter {
  private client;
  private logger;

  constructor() {
    const env = getEnvironment();
    this.logger = getLogger();

    this.client = createPublicClient({
      chain: polygon,
      transport: http(env.POLYGON_RPC_URL),
    });
  }

  async getBalance(address: `0x${string}`, tokenAddress?: `0x${string}`): Promise<bigint> {
    try {
      if (tokenAddress) {
        // ERC20 token balance
        return await this.readContract<bigint>({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        });
      } else {
        // Native balance (MATIC)
        return await this.client.getBalance({ address });
      }
    } catch (error) {
      this.logger.error({ error, address, tokenAddress }, 'Failed to get balance');
      throw new BlockchainError('Failed to get balance', { address, tokenAddress });
    }
  }

  async getCurrentBlock(): Promise<bigint> {
    try {
      const block = await this.client.getBlockNumber();
      return block;
    } catch (error) {
      this.logger.error({ error }, 'Failed to get current block');
      throw new BlockchainError('Failed to get current block');
    }
  }

  async readContract<T>(params: {
    address: `0x${string}`;
    abi: unknown[];
    functionName: string;
    args?: unknown[];
  }): Promise<T> {
    try {
      const result = await this.client.readContract({
        address: params.address,
        abi: params.abi as never,
        functionName: params.functionName,
        args: params.args,
      });
      return result as T;
    } catch (error) {
      this.logger.error({ error, params }, 'Failed to read contract');
      throw new BlockchainError('Failed to read contract', { functionName: params.functionName });
    }
  }

  async prepareTransaction(params: {
    to: `0x${string}`;
    data: `0x${string}`;
    value?: bigint;
  }): Promise<UnsignedTransaction> {
    const env = getEnvironment();

    try {
      const gasLimit = await this.estimateGas({
        to: params.to,
        data: params.data,
        value: params.value,
      });

      return {
        to: params.to,
        data: params.data,
        value: params.value || 0n,
        chainId: env.POLYGON_CHAIN_ID,
        gasLimit,
      };
    } catch (error) {
      this.logger.error({ error, params }, 'Failed to prepare transaction');
      throw new BlockchainError('Failed to prepare transaction');
    }
  }

  async estimateGas(params: {
    to: `0x${string}`;
    data: `0x${string}`;
    value?: bigint;
    from?: `0x${string}`;
  }): Promise<bigint> {
    try {
      const estimate = await this.client.estimateGas({
        to: params.to,
        data: params.data,
        value: params.value,
        account: params.from,
      });

      // Add 20% buffer to be safe
      return (estimate * 120n) / 100n;
    } catch (error) {
      this.logger.error({ error, params }, 'Failed to estimate gas');
      throw new BlockchainError('Failed to estimate gas');
    }
  }

  isValidAddress(address: string): boolean {
    return isAddress(address);
  }
}
