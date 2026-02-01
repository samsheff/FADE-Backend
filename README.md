# Polymarket Trading Terminal Backend

Deterministic, institutional-grade backend for a Polymarket prediction market trading terminal. This is a **non-intelligent** backend focused solely on market data, trade execution plumbing, and position tracking.

## Features

- **Market Data**: Fetch and cache Polymarket markets and orderbooks
- **Trade Preparation**: Build unsigned transactions for trades (never handles private keys)
- **Position Tracking**: Calculate positions and P&L from trade history
- **EIP-712 Authentication**: Wallet-based authentication using signed messages
- **Background Jobs**: Periodic market data sync and position updates
- **Type-Safe**: Full TypeScript with strict mode enabled
- **Fast**: Built with Fastify (2-3x faster than Express)
- **Blockchain-Native**: Uses viem for Ethereum/Polygon interactions

## Tech Stack

- **Framework**: Fastify (high-performance HTTP server)
- **Blockchain**: viem (TypeScript-native Ethereum library)
- **Database**: SQLite (development) / PostgreSQL (production)
- **ORM**: Prisma (type-safe database queries)
- **Validation**: Zod (environment config validation)
- **Package Manager**: pnpm (fast, efficient)

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 8+
- SQLite (development) or PostgreSQL (production)

### Installation

```bash
# Install dependencies
pnpm install

# Generate Prisma client
pnpm db:generate

# Run database migrations
pnpm db:migrate --name init

# Seed database with test data
pnpm db:seed
```

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Key variables:
- `DATABASE_URL`: Database connection string
- `POLYGON_RPC_URL`: Polygon RPC endpoint
- `POLYMARKET_CLOB_API_URL`: Polymarket CLOB API URL
- `PORT`: Server port (default: 3000)

### Running the Server

```bash
# Development (with hot reload)
pnpm dev

# Production build
pnpm build
pnpm start

# Run tests
pnpm test

# Test coverage
pnpm test:coverage
```

## API Documentation

Once the server is running, visit:
- API Docs: `http://localhost:3000/documentation`
- Health Check: `http://localhost:3000/health`

## API Endpoints

### Authentication

#### Request Nonce
```
GET /api/v1/auth/nonce?wallet=0x...
```
Returns a nonce and message for EIP-712 signing.

### Markets

#### List Markets
```
GET /api/v1/markets?active=true&category=crypto&limit=20&offset=0
```

#### Get Market Details
```
GET /api/v1/markets/:id
```

#### Get Orderbook
```
GET /api/v1/markets/:id/orderbook?outcome=YES
```

### Positions (Authenticated)

#### Get Wallet Positions
```
GET /api/v1/positions/:wallet
Headers: Authorization: Bearer <signature>
```

### Trades (Authenticated)

#### Prepare Trade
```
POST /api/v1/trades/prepare
Headers: Authorization: Bearer <signature>
Body: {
  "walletAddress": "0x...",
  "marketId": "0x...",
  "outcome": "YES",
  "side": "buy",
  "size": "100"
}
```

Returns an unsigned transaction ready for wallet signing.

## Authentication Flow

1. Frontend requests nonce: `GET /auth/nonce?wallet=0x...`
2. Backend returns nonce and timestamp
3. User signs EIP-712 structured message with their wallet
4. Frontend includes signature in `Authorization: Bearer <sig>` header
5. Backend verifies signature using viem's `verifyTypedData`

## Database Schema

### Market
- Market data from Polymarket CLOB
- Cached locally with periodic sync

### Trade
- Trade execution records
- Links to markets and wallets

### Position
- Aggregated position data per wallet/market/outcome
- Volume-weighted average entry price
- Realized and unrealized P&L

### OrderbookSnapshot
- Cached orderbook data
- Short TTL for fresh pricing

## Background Jobs

### Market Sync Job
- **Frequency**: Every 60 seconds
- **Task**: Fetch latest market data from Polymarket CLOB API
- **Updates**: Liquidity, volume, prices, active status

### Position Update Job
- **Frequency**: Every 5 minutes
- **Task**: Recalculate unrealized P&L for all positions
- **Uses**: Current market prices from orderbooks

## Security

### No Private Key Handling
- Backend NEVER receives or stores private keys
- All transactions are prepared unsigned
- Frontend handles wallet connection and signing

### Input Validation
- Fastify JSON schemas on all endpoints
- Zod validation for environment variables
- Address validation using viem's `isAddress()`
- Price range validation (0-1)
- Size validation (positive numbers)

### Rate Limiting
- 100 requests per minute per IP (global)
- Configurable per environment

### Error Handling
- Custom error hierarchy
- Never exposes internal errors to clients
- Structured error responses
- All errors logged with request context

## Project Structure

```
back/
├── src/
│   ├── config/              # Environment config, constants
│   ├── server/              # Fastify app setup
│   ├── routes/              # API endpoints
│   │   ├── auth/            # Authentication routes
│   │   ├── markets/         # Market data routes
│   │   ├── positions/       # Position routes
│   │   └── trades/          # Trade execution routes
│   ├── services/            # Business logic
│   │   ├── market-data/     # Market data service
│   │   ├── trade-execution/ # Trade preparation service
│   │   └── position-tracking/ # Position tracking service
│   ├── adapters/            # External integrations
│   │   ├── blockchain/      # viem adapter for Polygon
│   │   ├── polymarket/      # Polymarket CLOB API client
│   │   └── database/        # Prisma repositories
│   ├── middleware/          # Auth, validation, logging
│   ├── utils/               # Logger, errors, validators
│   ├── types/               # TypeScript type definitions
│   └── jobs/                # Background jobs
├── prisma/
│   ├── schema.prisma        # Database schema
│   ├── migrations/          # Migration files
│   └── seed.ts              # Test data seeding
└── tests/                   # Unit and integration tests
```

## Development

### Code Quality

```bash
# Lint code
pnpm lint

# Format code
pnpm format

# Type check
pnpm build
```

### Database Management

```bash
# Generate Prisma client after schema changes
pnpm db:generate

# Create a new migration
pnpm db:migrate --name <migration-name>

# Open Prisma Studio (database GUI)
pnpm db:studio

# Seed database
pnpm db:seed
```

## Production Deployment

### Environment Setup

1. Set `NODE_ENV=production`
2. Use PostgreSQL instead of SQLite
3. Configure proper `DATABASE_URL`
4. Set up secure RPC endpoint for Polygon
5. Configure rate limiting appropriately
6. Set up monitoring and logging

### Build and Deploy

```bash
# Build for production
pnpm build

# Start production server
NODE_ENV=production pnpm start
```

### Recommended Infrastructure

- **Database**: PostgreSQL with connection pooling
- **Hosting**: Railway, Render, AWS, or similar
- **Monitoring**: Sentry for errors, Datadog/Grafana for metrics
- **RPC**: Alchemy or Infura for reliable Polygon access

## Contract Addresses (Polygon Mainnet)

- **CTF Exchange**: `0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E`
- **Conditional Tokens**: `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`
- **USDC**: `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`
- **Chain ID**: 137 (Polygon Mainnet)

## Future Enhancements

This backend is designed for easy extension. Potential additions:

- **Signal Integration**: Add signal provider interfaces for AI/analysis
- **WebSocket Support**: Real-time market data and position updates
- **Advanced Analytics**: Historical performance tracking
- **Multi-wallet Support**: Track multiple wallets in one dashboard
- **Advanced Orders**: Limit orders, stop-loss (if supported by Polymarket)
- **Historical Data**: Store price snapshots for charting

## License

MIT

## Support

For issues, questions, or contributions, please open an issue on the repository.
