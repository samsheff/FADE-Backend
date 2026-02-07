import { z } from 'zod';

const optionalUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().url().optional(),
);

const optionalAddress = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
);

const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().optional(),
);

const envSchema = z.object({
  // Server Configuration
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).pipe(z.number().int().positive()).default('3000'),
  HOST: z.string().default('0.0.0.0'),

  // Database
  DATABASE_URL: z.string().url(),

  // Blockchain Configuration
  POLYGON_RPC_URL: z.string().url(),
  POLYGON_CHAIN_ID: z.string().transform(Number).pipe(z.number().int()).default('137'),

  // Polymarket CLOB API
  POLYMARKET_CLOB_API_URL: z.string().url().default('https://clob.polymarket.com'),
  POLYMARKET_GAMMA_API_URL: z.string().url().default('https://gamma-api.polymarket.com'),
  POLYMARKET_DATA_API_URL: z.string().url().default('https://data-api.polymarket.com'),
  GAMMA_API_REQUEST_INTERVAL_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default('2000'),
  POLYMARKET_CLOB_WS_URL: optionalUrl,
  POLYMARKET_CLOB_API_KEY: optionalString,
  POLYMARKET_CLOB_API_SECRET: optionalString,
  POLYMARKET_CLOB_API_PASSPHRASE: optionalString,
  POLYMARKET_CLOB_SIGNER_ADDRESS: optionalAddress,

  // Polymarket Indexer
  POLYMARKET_NETWORK: z.enum(['mainnet', 'testnet', 'fork']).default('mainnet'),
  POLYMARKET_RPC_URL: optionalUrl,
  POLYMARKET_MARKET_REGISTRY_ADDRESS: optionalAddress,
  POLYMARKET_MARKET_STATE_ADDRESS: optionalAddress,

  // Contract Addresses (Polygon Mainnet)
  CTF_EXCHANGE_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .default('0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E'),
  CONDITIONAL_TOKENS_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .default('0x4D97DCd97eC945f40cF65F87097ACe5EA0476045'),
  USDC_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .default('0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'),

  // Rate Limiting
  RATE_LIMIT_MAX: z.string().transform(Number).pipe(z.number().int().positive()).default('100'),
  RATE_LIMIT_WINDOW: z.string().transform(Number).pipe(z.number().int().positive()).default('60000'),

  // Security
  NONCE_TTL_MS: z.string().transform(Number).pipe(z.number().int().positive()).default('300000'),

  // Caching
  MARKET_CACHE_TTL_MS: z.string().transform(Number).pipe(z.number().int().positive()).default('60000'),
  ORDERBOOK_CACHE_TTL_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default('30000'),
  ORDERBOOK_SNAPSHOT_TTL_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default('30000'),

  // CLOB WebSocket
  CLOB_WS_HEARTBEAT_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default('15000'),
  CLOB_WS_RECONNECT_BASE_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default('1000'),
  CLOB_WS_RECONNECT_MAX_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default('30000'),

  // Background Jobs
  MARKET_SYNC_INTERVAL_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default('60000'),
  POSITION_UPDATE_INTERVAL_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default('300000'),

  // Historical Data Backfill
  HISTORICAL_BACKFILL_RATE_LIMIT_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default('1000'),
  HISTORICAL_BACKFILL_BATCH_SIZE: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default('5000'),

  // Market Data Management
  AUTO_DEACTIVATE_CLOSED_MARKETS: z
    .string()
    .transform((val) => val === 'true')
    .pipe(z.boolean())
    .default('false'),

  // Logging
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Environment = z.infer<typeof envSchema>;

let _env: Environment | null = null;

export function loadEnvironment(): Environment {
  if (_env) {
    return _env;
  }

  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('❌ Invalid environment variables:');
    console.error(parsed.error.format());
    throw new Error('Invalid environment configuration');
  }

  _env = parsed.data;
  return _env;
}

export function getEnvironment(): Environment {
  if (!_env) {
    throw new Error('Environment not loaded. Call loadEnvironment() first.');
  }
  return _env;
}
