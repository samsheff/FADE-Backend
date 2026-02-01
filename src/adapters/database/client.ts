import { PrismaClient } from '@prisma/client';
import { getLogger } from '../../utils/logger.js';

let prisma: PrismaClient;

export function createPrismaClient(): PrismaClient {
  const logger = getLogger();

  prisma = new PrismaClient({
    log: [
      { level: 'query', emit: 'event' },
      { level: 'error', emit: 'stdout' },
      { level: 'warn', emit: 'stdout' },
    ],
  });

  prisma.$on('query' as never, (e: { query: string; duration: number }) => {
    logger.debug({ query: e.query, duration: e.duration }, 'Database query');
  });

  return prisma;
}

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    throw new Error('Prisma client not initialized. Call createPrismaClient() first.');
  }
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
  }
}
