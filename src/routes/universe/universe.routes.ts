import { FastifyInstance } from 'fastify';
import { EdgarUniverseDiscoveryService } from '../../services/edgar/universe-discovery.service.js';
import { InstrumentRepository } from '../../adapters/database/repositories/instrument.repository.js';
import { getPrismaClient } from '../../adapters/database/client.js';

/**
 * Validate pagination parameters
 */
function validatePagination(
  limit?: number,
  offset?: number,
): { limit: number; offset: number } {
  const validatedLimit = Math.min(Math.max(1, limit || 20), 100);
  const validatedOffset = Math.max(0, offset || 0);
  return { limit: validatedLimit, offset: validatedOffset };
}

export async function universeRoutes(app: FastifyInstance): Promise<void> {
  const universeService = new EdgarUniverseDiscoveryService();
  const instrumentRepo = new InstrumentRepository();
  const prisma = getPrismaClient();

  /**
   * GET /api/v1/universe/stats
   * Returns universe statistics
   */
  app.get(
    '/stats',
    {
      schema: {
        tags: ['universe'],
        description: 'Get universe statistics',
        response: {
          200: {
            type: 'object',
            properties: {
              lastSync: {
                type: 'object',
                nullable: true,
                properties: {
                  syncCompletedAt: { type: 'string', format: 'date-time' },
                  totalIssuers: { type: 'number' },
                  newIssuers: { type: 'number' },
                  updatedIssuers: { type: 'number' },
                },
              },
              totalInstruments: { type: 'number' },
              activeInstruments: { type: 'number' },
              withRecentFilings: { type: 'number' },
            },
          },
        },
      },
    },
    async () => {
      const lastSync = await universeService.getLastSync();

      const [totalResult, activeResult, recentFilingsResult] = await Promise.all([
        instrumentRepo.findMany({ limit: 1, offset: 0 }),
        instrumentRepo.findMany({ isActive: true, limit: 1, offset: 0 }),
        instrumentRepo.findMany({ hasRecentFilings: true, limit: 1, offset: 0 }),
      ]);

      return {
        lastSync: lastSync
          ? {
              syncCompletedAt: lastSync.syncCompletedAt,
              totalIssuers: lastSync.totalIssuers,
              newIssuers: lastSync.newIssuers,
            }
          : null,
        totalInstruments: totalResult.total,
        activeInstruments: activeResult.total,
        withRecentFilings: recentFilingsResult.total,
      };
    },
  );

  /**
   * GET /api/v1/universe/recently-discovered
   * Returns recently discovered instruments
   */
  app.get<{
    Querystring: {
      days?: number;
      limit?: number;
      offset?: number;
    };
  }>(
    '/recently-discovered',
    {
      schema: {
        tags: ['universe'],
        description: 'Get recently discovered instruments',
        querystring: {
          type: 'object',
          properties: {
            days: { type: 'number', default: 7 },
            limit: { type: 'number', default: 20 },
            offset: { type: 'number', default: 0 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              instruments: {
                type: 'array',
                items: { type: 'object' },
              },
              total: { type: 'number' },
              daysAgo: { type: 'number' },
            },
          },
        },
      },
    },
    async (request) => {
      const days = request.query.days || 7;
      const { limit, offset } = validatePagination(
        request.query.limit,
        request.query.offset,
      );

      const discoveredAfter = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const result = await instrumentRepo.findMany({
        discoveredAfter,
        limit,
        offset,
      });

      return {
        instruments: result.instruments,
        total: result.total,
        daysAgo: days,
      };
    },
  );

  /**
   * GET /api/v1/universe/newly-flagged
   * Returns instruments with new signals
   */
  app.get<{
    Querystring: {
      days?: number;
      signalType?: string;
      minSeverity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      limit?: number;
      offset?: number;
    };
  }>(
    '/newly-flagged',
    {
      schema: {
        tags: ['universe'],
        description: 'Get instruments with new signals',
        querystring: {
          type: 'object',
          properties: {
            days: { type: 'number', default: 7 },
            signalType: {
              type: 'string',
              enum: ['DILUTION_RISK', 'TOXIC_FINANCING_RISK', 'DISTRESS_RISK', 'VOLATILITY_SPIKE'],
            },
            minSeverity: {
              type: 'string',
              enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
            },
            limit: { type: 'number', default: 20 },
            offset: { type: 'number', default: 0 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              signals: {
                type: 'array',
                items: { type: 'object' },
              },
              total: { type: 'number' },
              daysAgo: { type: 'number' },
            },
          },
        },
      },
    },
    async (request) => {
      const days = request.query.days || 7;
      const { limit, offset } = validatePagination(
        request.query.limit,
        request.query.offset,
      );

      const computedAfter = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      // Severity ordering for filtering
      const severityOrder = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
      const minSeverityValue = request.query.minSeverity
        ? severityOrder[request.query.minSeverity]
        : 1;

      // Direct Prisma query with joins
      const where: any = {
        computedAt: { gte: computedAfter },
        ...(request.query.signalType && { signalType: request.query.signalType }),
      };

      const [allSignals, total] = await Promise.all([
        (prisma as any).instrumentSignal.findMany({
          where,
          include: {
            instrument: {
              include: {
                identifiers: true,
              },
            },
          },
          take: limit * 2, // Fetch extra since we filter after
          skip: offset,
          orderBy: { computedAt: 'desc' },
        }),
        (prisma as any).instrumentSignal.count({ where }),
      ]);

      // Filter by severity after fetching (since severity comparison needs custom logic)
      const signals = allSignals.filter((signal: any) => {
        const signalSeverityValue = severityOrder[signal.severity as keyof typeof severityOrder];
        return signalSeverityValue >= minSeverityValue;
      }).slice(0, limit);

      return {
        signals,
        total,
        daysAgo: days,
      };
    },
  );

  /**
   * GET /api/v1/universe/search
   * Search instruments by symbol or name
   */
  app.get<{
    Querystring: {
      q: string;
      limit?: number;
      offset?: number;
    };
  }>(
    '/search',
    {
      schema: {
        tags: ['universe'],
        description: 'Search instruments by symbol or name',
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string' },
            limit: { type: 'number', default: 20 },
            offset: { type: 'number', default: 0 },
          },
          required: ['q'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              instruments: {
                type: 'array',
                items: { type: 'object' },
              },
              total: { type: 'number' },
              query: { type: 'string' },
            },
          },
        },
      },
    },
    async (request) => {
      const query = request.query.q;
      const { limit, offset } = validatePagination(
        request.query.limit,
        request.query.offset,
      );

      // Search by symbol OR name (case-insensitive)
      const where = {
        OR: [
          { symbol: { contains: query, mode: 'insensitive' as const } },
          { name: { contains: query, mode: 'insensitive' as const } },
        ],
      };

      const [instruments, total] = await Promise.all([
        (prisma as any).instrument.findMany({
          where,
          include: {
            identifiers: true,
          },
          take: limit,
          skip: offset,
          orderBy: { updatedAt: 'desc' },
        }),
        (prisma as any).instrument.count({ where }),
      ]);

      return {
        instruments,
        total,
        query,
      };
    },
  );
}
