import { FastifyInstance } from 'fastify';
import { getPrismaClient } from '../adapters/database/client.js';

/**
 * Health check route
 * Used by App Platform, load balancers, and monitoring systems
 */
export async function healthRoute(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => {
    try {
      // Check database connectivity
      const prisma = getPrismaClient();
      await prisma.$queryRaw`SELECT 1`;

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'polymarket-terminal-api',
        database: 'connected',
      };
    } catch (error) {
      reply.status(503);
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        service: 'polymarket-terminal-api',
        database: 'disconnected',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
