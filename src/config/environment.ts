import { z } from 'zod';

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
