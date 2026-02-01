import { createPublicClient, http } from 'viem';
import { polygon, polygonMumbai } from 'viem/chains';
import { getEnvironment } from '../../config/environment.js';
import { getLogger } from '../../utils/logger.js';

export type PolymarketNetwork = 'mainnet' | 'testnet' | 'fork';

export interface PolymarketMarket {
  id: string;
  polymarketMarketId: string | null;
  question: string;
  outcomes: string[];
  expiryDate: Date;
  marketSlug: string;
  categoryTag: string | null;
  active: boolean;
  tokens: Record<string, string>;
}

export interface PolymarketMarketState {
  yesPrice: string | null;
  noPrice: string | null;
  liquidity: string | null;
  volume: string | null;
  lastUpdatedBlock: string | null;
}

const NETWORK_CONFIG = {
  mainnet: {
    chain: polygon,
    // TODO: replace with the official Polymarket Market Registry address.
    marketRegistryAddress: '0x0000000000000000000000000000000000000000',
    // TODO: replace with the official Polymarket Market State address.
    marketStateAddress: '0x0000000000000000000000000000000000000000',
  },
  testnet: {
    chain: polygonMumbai,
    // TODO: confirm Polymarket testnet/fork addresses if available.
    marketRegistryAddress: '0x0000000000000000000000000000000000000000',
    marketStateAddress: '0x0000000000000000000000000000000000000000',
  },
  fork: {
    chain: polygon,
    // TODO: update for local fork deployments.
    marketRegistryAddress: '0x0000000000000000000000000000000000000000',
    marketStateAddress: '0x0000000000000000000000000000000000000000',
  },
} as const;

// TODO: Replace placeholder ABI with the official Polymarket Market Registry ABI.
const MARKET_REGISTRY_ABI = [
  {
    name: 'getMarketCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'count', type: 'uint256' }],
  },
  {
    name: 'getMarket',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'index', type: 'uint256' }],
    outputs: [
      { name: 'conditionId', type: 'bytes32' },
      { name: 'marketId', type: 'uint256' },
      { name: 'endTime', type: 'uint256' },
      { name: 'active', type: 'bool' },
      { name: 'question', type: 'string' },
      { name: 'slug', type: 'string' },
      { name: 'category', type: 'string' },
      { name: 'outcomes', type: 'string[]' },
      { name: 'tokenIds', type: 'uint256[]' },
    ],
  },
] as const;

// TODO: Replace placeholder ABI with the official Polymarket Market State ABI.
const MARKET_STATE_ABI = [
  {
    name: 'getMarketState',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'conditionId', type: 'bytes32' }],
    outputs: [
      { name: 'yesPrice', type: 'uint256' },
      { name: 'noPrice', type: 'uint256' },
      { name: 'liquidity', type: 'uint256' },
      { name: 'volume', type: 'uint256' },
      { name: 'lastUpdatedBlock', type: 'uint256' },
    ],
  },
] as const;

export class PolymarketAdapter {
  private client;
  private logger;
  private network: PolymarketNetwork;
  private marketRegistryAddress: `0x${string}`;
  private marketStateAddress: `0x${string}`;

  constructor() {
    const env = getEnvironment();
    this.logger = getLogger();

    this.network = (env.POLYMARKET_NETWORK || 'mainnet') as PolymarketNetwork;
    const config = NETWORK_CONFIG[this.network];

    const rpcUrl = env.POLYMARKET_RPC_URL || env.POLYGON_RPC_URL;
    this.client = createPublicClient({
      chain: config.chain,
      transport: http(rpcUrl),
    });

    this.marketRegistryAddress = (env.POLYMARKET_MARKET_REGISTRY_ADDRESS ||
      config.marketRegistryAddress) as `0x${string}`;
    this.marketStateAddress = (env.POLYMARKET_MARKET_STATE_ADDRESS ||
      config.marketStateAddress) as `0x${string}`;
  }

  async getAllMarkets(): Promise<PolymarketMarket[]> {
    if (this.isZeroAddress(this.marketRegistryAddress)) {
      this.logger.warn(
        { network: this.network },
        'Market registry address not configured; skipping full sync',
      );
      return [];
    }

    try {
      const count = await this.client.readContract({
        address: this.marketRegistryAddress,
        abi: MARKET_REGISTRY_ABI,
        functionName: 'getMarketCount',
      });

      const marketCount = Number(count);
      const markets: PolymarketMarket[] = [];

      for (let i = 0; i < marketCount; i += 1) {
        const data = await this.client.readContract({
          address: this.marketRegistryAddress,
          abi: MARKET_REGISTRY_ABI,
          functionName: 'getMarket',
          args: [BigInt(i)],
        });

        markets.push(this.toMarket(data));
      }

      return markets;
    } catch (error) {
      this.logger.error({ error }, 'Failed to fetch markets from chain');
      throw error;
    }
  }

  async getMarketById(conditionId: string): Promise<PolymarketMarket | null> {
    if (this.isZeroAddress(this.marketRegistryAddress)) {
      this.logger.warn(
        { network: this.network, conditionId },
        'Market registry address not configured; cannot fetch market by id',
      );
      return null;
    }

    try {
      // TODO: Replace with direct lookup once the official registry ABI is wired.
      const markets = await this.getAllMarkets();
      return markets.find((market) => market.id === conditionId) || null;
    } catch (error) {
      this.logger.error({ error, conditionId }, 'Failed to fetch market by id');
      throw error;
    }
  }

  async getMarketState(conditionId: string): Promise<PolymarketMarketState> {
    if (this.isZeroAddress(this.marketStateAddress)) {
      this.logger.warn(
        { network: this.network, conditionId },
        'Market state address not configured; returning null state',
      );
      return {
        yesPrice: null,
        noPrice: null,
        liquidity: null,
        volume: null,
        lastUpdatedBlock: null,
      };
    }

    try {
      const [yesPrice, noPrice, liquidity, volume, lastUpdatedBlock] =
        await this.client.readContract({
          address: this.marketStateAddress,
          abi: MARKET_STATE_ABI,
          functionName: 'getMarketState',
          args: [conditionId as `0x${string}`],
        });

      return {
        yesPrice: yesPrice.toString(),
        noPrice: noPrice.toString(),
        liquidity: liquidity.toString(),
        volume: volume.toString(),
        lastUpdatedBlock: lastUpdatedBlock.toString(),
      };
    } catch (error) {
      this.logger.error({ error, conditionId }, 'Failed to fetch market state');
      throw error;
    }
  }

  async getOutcomePrices(conditionId: string): Promise<{ yesPrice: string | null; noPrice: string | null }> {
    const state = await this.getMarketState(conditionId);
    return { yesPrice: state.yesPrice, noPrice: state.noPrice };
  }

  async getCurrentBlockNumber(): Promise<bigint> {
    return await this.client.getBlockNumber();
  }

  private toMarket(data: readonly unknown[]): PolymarketMarket {
    const [
      conditionId,
      marketId,
      endTime,
      active,
      question,
      slug,
      category,
      outcomes,
      tokenIds,
    ] = data as [
      `0x${string}`,
      bigint,
      bigint,
      boolean,
      string,
      string,
      string,
      string[],
      bigint[],
    ];

    const tokens: Record<string, string> = {};
    outcomes.forEach((outcome, index) => {
      tokens[outcome] = tokenIds[index]?.toString() || '';
    });

    return {
      id: conditionId,
      polymarketMarketId: marketId?.toString() || null,
      question,
      outcomes,
      expiryDate: new Date(Number(endTime) * 1000),
      marketSlug: slug,
      categoryTag: category || null,
      active,
      tokens,
    };
  }

  private isZeroAddress(address: string): boolean {
    return /^0x0{40}$/.test(address);
  }
}
