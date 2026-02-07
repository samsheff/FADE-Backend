import { FastifyInstance } from 'fastify';
import { nonceRoutes } from './auth/nonce.js';
import { getMarketsRoutes } from './markets/get-markets.js';
import { getCandlesRoutes } from './markets/get-candles.js';
import { getPositionsRoutes } from './positions/get-positions.js';
import { prepareTradeRoutes } from './trades/prepare-trade.js';
import { backfillRoutes } from './admin/backfill.routes.js';
import { instrumentsRoutes } from './instruments/instruments.routes.js';
import { signalsRoutes } from './signals/signals.routes.js';
import { filingsRoutes } from './filings/filings.routes.js';
import { universeRoutes } from './universe/universe.routes.js';
import { searchRoutes } from './search/search.routes.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Auth routes
  await app.register(nonceRoutes, { prefix: '/api/v1/auth' });

  // Market routes
  await app.register(getMarketsRoutes, { prefix: '/api/v1/markets' });
  await app.register(getCandlesRoutes, { prefix: '/api/v1/markets' });

  // Position routes
  await app.register(getPositionsRoutes, { prefix: '/api/v1/positions' });

  // Trade routes
  await app.register(prepareTradeRoutes, { prefix: '/api/v1/trades' });

  // Admin routes
  await app.register(backfillRoutes, { prefix: '/api/v1/admin' });

  // EDGAR routes
  await app.register(instrumentsRoutes, { prefix: '/api/v1/instruments' });
  await app.register(signalsRoutes, { prefix: '/api/v1/signals' });
  await app.register(filingsRoutes, { prefix: '/api/v1/filings' });
  await app.register(universeRoutes, { prefix: '/api/v1/universe' });

  // Search routes
  await app.register(searchRoutes, { prefix: '/api/v1/search' });
}
