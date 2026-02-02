import { PrismaClient, AuthNonce as PrismaAuthNonce } from '@prisma/client';
import { getPrismaClient } from '../client.js';
import { NonceData } from '../../../types/auth.types.js';

export class NonceRepository {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = getPrismaClient();
  }

  async upsert(walletAddress: string, nonce: string, timestamp: number, expiresAt: Date): Promise<void> {
    await this.prisma.authNonce.upsert({
      where: { walletAddress },
      create: {
        walletAddress,
        nonce,
        timestamp,
        expiresAt,
      },
      update: {
        nonce,
        timestamp,
        expiresAt,
      },
    });
  }

  async find(walletAddress: string): Promise<NonceData | null> {
    const record = await this.prisma.authNonce.findUnique({
      where: { walletAddress },
    });

    if (!record) {
      return null;
    }

    return this.toModel(record);
  }

  async delete(walletAddress: string): Promise<void> {
    await this.prisma.authNonce.deleteMany({
      where: { walletAddress },
    });
  }

  async deleteExpired(now: Date): Promise<number> {
    const result = await this.prisma.authNonce.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    return result.count;
  }

  private toModel(record: PrismaAuthNonce): NonceData {
    return {
      nonce: record.nonce,
      timestamp: record.timestamp,
      expiresAt: record.expiresAt.getTime(),
    };
  }
}
