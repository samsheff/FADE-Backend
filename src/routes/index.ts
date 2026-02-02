import { FastifyInstance } from 'fastify';
import { nonceRoutes } from './auth/nonce.js';
import { getMarketsRoutes } from './markets/get-markets.js';
import { getCandlesRoutes } from './markets/get-candles.js';
import { getPositionsRoutes } from './positions/get-positions.js';
import { prepareTradeRoutes } from './trades/prepare-trade.js';

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
}
