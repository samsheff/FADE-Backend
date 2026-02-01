# Polymarket Terminal Backend - Quick Start Guide

Get up and running in under 5 minutes!

## Prerequisites

- Node.js 18+ installed
- pnpm installed (`npm install -g pnpm`)

## Installation

```bash
# 1. Install dependencies
pnpm install

# 2. Generate Prisma client
pnpm db:generate

# 3. Run database migrations
pnpm db:migrate --name init

# 4. Seed database with test data
pnpm db:seed
```

## Running the Server

```bash
# Development mode (with hot reload)
pnpm dev
```

The server will start on `http://localhost:3000`

## Verify Installation

Open a new terminal and run:

```bash
# Check health
curl http://localhost:3000/health

# List markets
curl http://localhost:3000/api/v1/markets

# Run verification script
bash scripts/verify-api.sh
```

Or visit in your browser:
- **API Docs**: http://localhost:3000/documentation
- **Health Check**: http://localhost:3000/health

## Example API Calls

### Get Markets
```bash
curl http://localhost:3000/api/v1/markets
```

### Filter Markets
```bash
curl "http://localhost:3000/api/v1/markets?active=true&category=crypto&limit=10"
```

### Get Market Details
```bash
curl http://localhost:3000/api/v1/markets/0x1234567890abcdef1234567890abcdef12345678
```

### Get Authentication Nonce
```bash
curl "http://localhost:3000/api/v1/auth/nonce?wallet=0x742d35Cc6634C0532925a3b844Bc454e4438f44e"
```

### Response Example
```json
{
  "nonce": "abc123xyz",
  "timestamp": 1234567890,
  "message": "Sign in to Polymarket Terminal\n\nWallet: 0x742d...\nNonce: abc123xyz\nTimestamp: 1234567890"
}
```

## Testing

```bash
# Run integration tests
pnpm test

# Run with coverage
pnpm test:coverage
```

## Development Tools

```bash
# Open Prisma Studio (database GUI)
pnpm db:studio

# Lint code
pnpm lint

# Format code
pnpm format

# Build for production
pnpm build
```

## Project Structure

```
back/
├── src/
│   ├── routes/         # API endpoints
│   ├── services/       # Business logic
│   ├── adapters/       # External integrations
│   ├── middleware/     # Auth, validation
│   └── utils/          # Helpers
├── prisma/
│   └── schema.prisma   # Database schema
└── tests/              # Test files
```

## Environment Configuration

Default `.env` is configured for local development with SQLite. To customize:

1. Copy `.env.example` to `.env`
2. Modify variables as needed
3. Restart server

Key variables:
- `PORT`: Server port (default: 3000)
- `DATABASE_URL`: Database connection
- `POLYGON_RPC_URL`: Polygon RPC endpoint
- `LOG_LEVEL`: Logging level (info, debug, etc.)

## Next Steps

1. **Explore the API**: Open http://localhost:3000/documentation
2. **Read the README**: See `README.md` for full documentation
3. **Check Examples**: Try the example API calls above
4. **Run Tests**: Verify everything works with `pnpm test`

## Common Issues

### Port Already in Use
```bash
# Change port in .env
PORT=3001
```

### Database Issues
```bash
# Reset database
rm prisma/dev.db
pnpm db:migrate --name init
pnpm db:seed
```

### Module Not Found
```bash
# Reinstall dependencies
rm -rf node_modules
pnpm install
```

## Getting Help

- Check `README.md` for detailed documentation
- Check `IMPLEMENTATION_SUMMARY.md` for architecture details
- View API docs at `/documentation`
- Check logs in development mode

## Production Deployment

For production deployment:

1. Use PostgreSQL instead of SQLite
2. Set `NODE_ENV=production`
3. Configure proper RPC endpoints
4. Set up monitoring and logging
5. Review security settings

See `README.md` for production deployment guide.

---

**That's it!** You now have a fully functional Polymarket Trading Terminal Backend running locally. 🎉

Visit http://localhost:3000/documentation to explore the API!
