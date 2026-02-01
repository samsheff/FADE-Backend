import { getEnvironment } from './environment.js';

export const POLYGON_CHAIN_ID = 137;

export const CONTRACTS = {
  CTF_EXCHANGE: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
  CONDITIONAL_TOKENS: '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045',
  USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
} as const;

export const API_ROUTES = {
  AUTH: '/api/v1/auth',
  MARKETS: '/api/v1/markets',
  POSITIONS: '/api/v1/positions',
  TRADES: '/api/v1/trades',
  HEALTH: '/health',
} as const;

export const EIP712_DOMAIN = {
  name: 'Polymarket Terminal',
  version: '1',
  chainId: POLYGON_CHAIN_ID,
} as const;

export const EIP712_TYPES = {
  SignIn: [
    { name: 'wallet', type: 'address' },
    { name: 'nonce', type: 'string' },
    { name: 'timestamp', type: 'uint256' },
  ],
} as const;

// CTF Exchange ABI - minimal interface for trade preparation
export const CTF_EXCHANGE_ABI = [
  {
    name: 'fillOrder',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        components: [
          { name: 'salt', type: 'uint256' },
          { name: 'maker', type: 'address' },
          { name: 'signer', type: 'address' },
          { name: 'taker', type: 'address' },
          { name: 'tokenId', type: 'uint256' },
          { name: 'makerAmount', type: 'uint256' },
          { name: 'takerAmount', type: 'uint256' },
          { name: 'expiration', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'feeRateBps', type: 'uint256' },
          { name: 'side', type: 'uint8' },
          { name: 'signatureType', type: 'uint8' },
        ],
      },
      { name: 'signature', type: 'bytes' },
      { name: 'fillAmount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'id', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// Conditional Tokens ABI - minimal interface
export const CONDITIONAL_TOKENS_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'id', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// ERC20 ABI - for USDC
export const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export function getContractAddress(contract: keyof typeof CONTRACTS): `0x${string}` {
  const env = getEnvironment();
  switch (contract) {
    case 'CTF_EXCHANGE':
      return env.CTF_EXCHANGE_ADDRESS as `0x${string}`;
    case 'CONDITIONAL_TOKENS':
      return env.CONDITIONAL_TOKENS_ADDRESS as `0x${string}`;
    case 'USDC':
      return env.USDC_ADDRESS as `0x${string}`;
  }
}
