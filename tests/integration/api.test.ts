import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { loadEnvironment } from '../../src/config/environment.js';
import { createLogger } from '../../src/utils/logger.js';
import { createPrismaClient, disconnectPrisma } from '../../src/adapters/database/client.js';
import { createApp } from '../../src/server/app.js';
import { registerRoutes } from '../../src/routes/index.js';

describe('API Integration Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    loadEnvironment();
    createLogger();
    createPrismaClient();
    app = await createApp();
    await registerRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrisma();
  });

  describe('Health Check', () => {
    it('should return ok status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeDefined();
    });
  });

  describe('Markets API', () => {
    it('should list markets', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/markets',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.markets).toBeInstanceOf(Array);
      expect(body.total).toBeGreaterThanOrEqual(0);
    });

    it('should filter markets by active status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/markets?active=true',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.markets).toBeInstanceOf(Array);
    });

    it('should paginate markets', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/markets?limit=1&offset=0',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.markets.length).toBeLessThanOrEqual(1);
    });
  });

  describe('Auth API', () => {
    it('should generate nonce for wallet', async () => {
      const wallet = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/nonce?wallet=${wallet}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.nonce).toBeDefined();
      expect(body.timestamp).toBeDefined();
      expect(body.message).toContain(wallet);
    });

    it('should reject invalid wallet address', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/nonce?wallet=invalid',
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
