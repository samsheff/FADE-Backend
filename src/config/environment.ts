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
  PORT: z.string().transform(Number).pipe(z.number().int().positive()).default(3000),
  HOST: z.string().default('0.0.0.0'),

  // Database
  DATABASE_URL: z.string().url(),

  // Blockchain Configuration
  POLYGON_RPC_URL: z.string().url(),
  POLYGON_CHAIN_ID: z.string().transform(Number).pipe(z.number().int()).default(137),

  // Polymarket CLOB API
  POLYMARKET_CLOB_API_URL: z.string().url().default('https://clob.polymarket.com'),
  POLYMARKET_GAMMA_API_URL: z.string().url().default('https://gamma-api.polymarket.com'),
  POLYMARKET_DATA_API_URL: z.string().url().default('https://data-api.polymarket.com'),
  GAMMA_API_REQUEST_INTERVAL_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(2000),
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
  RATE_LIMIT_MAX: z.string().transform(Number).pipe(z.number().int().positive()).default(100),
  RATE_LIMIT_WINDOW: z.string().transform(Number).pipe(z.number().int().positive()).default(60000),

  // Security
  NONCE_TTL_MS: z.string().transform(Number).pipe(z.number().int().positive()).default(300000),
  CORS_ORIGIN: z.string().default('*'),

  // Caching
  MARKET_CACHE_TTL_MS: z.string().transform(Number).pipe(z.number().int().positive()).default(60000),
  ORDERBOOK_CACHE_TTL_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(30000),
  ORDERBOOK_SNAPSHOT_TTL_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(30000),

  // CLOB WebSocket
  CLOB_WS_HEARTBEAT_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(15000),
  CLOB_WS_RECONNECT_BASE_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(1000),
  CLOB_WS_RECONNECT_MAX_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(30000),

  // Background Jobs
  MARKET_SYNC_INTERVAL_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(60000),
  POSITION_UPDATE_INTERVAL_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(300000),

  // Historical Data Backfill
  HISTORICAL_BACKFILL_RATE_LIMIT_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(1000),
  HISTORICAL_BACKFILL_BATCH_SIZE: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(5000),

  // Market Data Management
  AUTO_DEACTIVATE_CLOSED_MARKETS: z
    .string()
    .transform((val) => val === 'true')
    .pipe(z.boolean())
    .default(false),

  // ============================================================================
  // EDGAR Worker Configuration
  // ============================================================================

  EDGAR_WORKER_ENABLED: z
    .string()
    .transform((val) => val === 'true')
    .pipe(z.boolean())
    .default(false),

  EDGAR_SYNC_INTERVAL_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(3600000), // 1 hour

  EDGAR_UNIVERSE_SYNC_INTERVAL_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(86400000), // 24 hours

  EDGAR_STORAGE_PATH: z
    .string()
    .default('./storage/edgar'),

  // S3 Storage Configuration for EDGAR
  EDGAR_STORAGE_TYPE: z
    .enum(['local', 's3'])
    .default('local'),

  EDGAR_S3_BUCKET: optionalString,
  EDGAR_S3_ENDPOINT: optionalUrl,
  EDGAR_S3_REGION: optionalString,
  EDGAR_S3_ACCESS_KEY: optionalString,
  EDGAR_S3_SECRET_KEY: optionalString,

  EDGAR_API_USER_AGENT: z
    .string()
    .default('Trading Terminal Bot (contact@example.com)'),

  EDGAR_API_RATE_LIMIT_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(100), // 10 req/sec max per SEC guidelines

  EDGAR_BATCH_SIZE: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(10),

  // Discovery mode settings
  EDGAR_DISCOVERY_MODE: z
    .string()
    .transform((val) => val === 'true')
    .pipe(z.boolean())
    .default(true),

  // Historical Backfill Configuration
  EDGAR_BACKFILL_ENABLED: z
    .string()
    .transform((val) => val === 'true')
    .pipe(z.boolean())
    .default(true),

  EDGAR_BACKFILL_LOOKBACK_DAYS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(90), // 90 days of historical data

  EDGAR_BACKFILL_MAX_PAGES_PER_FORM: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(50), // 50 pages × 100 = 5,000 filings max per form type

  // Signal computation thresholds (configurable)
  SIGNAL_DILUTION_SHELF_THRESHOLD_PCT: z
    .string()
    .transform(Number)
    .pipe(z.number())
    .default(20), // Shelf > 20% of market cap = HIGH

  SIGNAL_TOXIC_PRICE_THRESHOLD: z
    .string()
    .transform(Number)
    .pipe(z.number())
    .default(2), // Stock price < $2 = risk factor

  SIGNAL_REVERSE_SPLIT_LOOKBACK_MONTHS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(12),

  // ============================================================================
  // News Worker Configuration
  // ============================================================================

  NEWS_WORKER_ENABLED: z
    .string()
    .transform((val) => val === 'true')
    .pipe(z.boolean())
    .default(false),

  NEWS_SYNC_INTERVAL_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(3600000), // 1 hour

  NEWS_STORAGE_PATH: z
    .string()
    .default('./storage/news'),

  // S3 Storage Configuration for News
  NEWS_STORAGE_TYPE: z
    .enum(['local', 's3'])
    .default('local'),

  NEWS_S3_BUCKET: optionalString,
  NEWS_S3_ENDPOINT: optionalUrl,
  NEWS_S3_REGION: optionalString,
  NEWS_S3_ACCESS_KEY: optionalString,
  NEWS_S3_SECRET_KEY: optionalString,

  NEWS_BATCH_SIZE: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(20),

  NEWS_BACKFILL_ENABLED: z
    .string()
    .transform((val) => val === 'true')
    .pipe(z.boolean())
    .default(true),

  NEWS_BACKFILL_LOOKBACK_DAYS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(7), // 1 week of historical news

  // Finnhub API Configuration
  FINNHUB_API_KEY: z
    .string()
    .default(''),

  FINNHUB_API_BASE_URL: z
    .string()
    .url()
    .default('https://finnhub.io'),

  FINNHUB_API_RATE_LIMIT_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(1000), // 1 req/sec = 60 req/min

  // Signal extraction thresholds
  SIGNAL_NEWS_MIN_CONFIDENCE: z
    .string()
    .transform(Number)
    .pipe(z.number())
    .default(0.7),

  // ============================================================================
  // Entity Enrichment Configuration
  // ============================================================================

  ENTITY_ENRICHMENT_ENABLED: z
    .string()
    .transform((val) => val === 'true')
    .pipe(z.boolean())
    .default(true),

  ENTITY_ENRICHMENT_INTERVAL_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(604800000), // 7 days (weekly)

  ENTITY_ENRICHMENT_BATCH_SIZE: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(100),

  // ============================================================================
  // Signal Computation Configuration
  // ============================================================================

  SIGNAL_COMPUTATION_ENABLED: z
    .string()
    .transform((val) => val === 'true')
    .pipe(z.boolean())
    .default(true),

  SIGNAL_COMPUTATION_INTERVAL_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(900000), // 15 minutes

  SIGNAL_MIN_CONFIDENCE_THRESHOLD: z
    .string()
    .transform(Number)
    .pipe(z.number())
    .default(0.6),

  SIGNAL_EXPIRATION_DAYS: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(7),

  // ============================================================================
  // Elasticsearch Configuration
  // ============================================================================

  ELASTICSEARCH_URL: z.string().url().default('http://localhost:9200'),
  ELASTICSEARCH_INDEX_PREFIX: z.string().default('terminal_'),
  SEARCH_INDEXER_ENABLED: z
    .string()
    .transform((val) => val === 'true')
    .pipe(z.boolean())
    .default(true),
  SEARCH_INDEXER_BATCH_SIZE: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(100),

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

/**
 * Convenient proxy to get environment variables
 * Throws if environment not loaded
 */
export const env = new Proxy({} as Environment, {
  get(_target, prop: string) {
    return getEnvironment()[prop as keyof Environment];
  },
});
