import { FastifyRequest, FastifyReply } from 'fastify';
import { verifySignInSignature } from '../utils/signature-verification.js';
import { UnauthorizedError } from '../utils/errors.js';
import { validateAddress } from '../utils/validators.js';
import { NonceData } from '../types/auth.types.js';
import { getEnvironment } from '../config/environment.js';
import { NonceRepository } from '../adapters/database/repositories/nonce.repository.js';

let nonceRepo: NonceRepository | null = null;

function getNonceRepo(): NonceRepository {
  if (!nonceRepo) {
    nonceRepo = new NonceRepository();
  }
  return nonceRepo;
}

export function storeNonce(wallet: string, nonce: string, timestamp: number): void {
  const env = getEnvironment();
  const expiresAt = Date.now() + env.NONCE_TTL_MS;

  const repo = getNonceRepo();
  void repo.upsert(wallet, nonce, timestamp, new Date(expiresAt));
  void repo.deleteExpired(new Date());
}

export async function getNonce(wallet: string): Promise<NonceData | undefined> {
  const nonce = await getNonceRepo().find(wallet);
  return nonce ?? undefined;
}

export function deleteNonce(wallet: string): void {
  void getNonceRepo().delete(wallet);
}

export async function authMiddleware(
  request: FastifyRequest<{
    Params: { wallet?: string };
    Body?: { wallet?: string; walletAddress?: string };
  }>,
  _reply: FastifyReply,
): Promise<void> {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid authorization header');
    }

    const signature = authHeader.substring(7) as `0x${string}`;

    // Get wallet address from params or body
    const walletAddress =
      request.params.wallet ||
      (request.body as { wallet?: string; walletAddress?: string } | undefined)?.walletAddress ||
      (request.body as { wallet?: string; walletAddress?: string } | undefined)?.wallet;
    if (!walletAddress) {
      throw new UnauthorizedError('Wallet address required');
    }

    validateAddress(walletAddress);

    // Get stored nonce
    const nonceData = await getNonceRepo().find(walletAddress);
    if (!nonceData) {
      throw new UnauthorizedError('No nonce found. Request a new nonce first.');
    }

    // Check if nonce is expired
    if (Date.now() > nonceData.expiresAt) {
      await getNonceRepo().delete(walletAddress);
      throw new UnauthorizedError('Nonce expired. Request a new nonce.');
    }

    // Verify signature
    const message = {
      wallet: walletAddress as `0x${string}`,
      nonce: nonceData.nonce,
      timestamp: BigInt(nonceData.timestamp),
    };

    await verifySignInSignature(message, signature, walletAddress as `0x${string}`);

    // Signature is valid - invalidate nonce (single-use)
    await getNonceRepo().delete(walletAddress);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }
    throw new UnauthorizedError('Authentication failed');
  }
}
