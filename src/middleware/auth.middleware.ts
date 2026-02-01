import { FastifyRequest, FastifyReply } from 'fastify';
import { verifySignInSignature } from '../utils/signature-verification.js';
import { UnauthorizedError } from '../utils/errors.js';
import { validateAddress } from '../utils/validators.js';
import { NonceData } from '../types/auth.types.js';
import { getEnvironment } from '../config/environment.js';

// In-memory nonce storage
// In production, use Redis or similar
const nonces = new Map<string, NonceData>();

export function storeNonce(wallet: string, nonce: string, timestamp: number): void {
  const env = getEnvironment();
  const expiresAt = Date.now() + env.NONCE_TTL_MS;

  nonces.set(wallet, {
    nonce,
    timestamp,
    expiresAt,
  });

  // Clean up expired nonces periodically
  cleanupExpiredNonces();
}

export function getNonce(wallet: string): NonceData | undefined {
  return nonces.get(wallet);
}

export function deleteNonce(wallet: string): void {
  nonces.delete(wallet);
}

function cleanupExpiredNonces(): void {
  const now = Date.now();
  for (const [wallet, data] of nonces.entries()) {
    if (data.expiresAt < now) {
      nonces.delete(wallet);
    }
  }
}

export async function authMiddleware(
  request: FastifyRequest<{
    Params: { wallet?: string };
  }>,
  reply: FastifyReply,
): Promise<void> {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid authorization header');
    }

    const signature = authHeader.substring(7) as `0x${string}`;

    // Get wallet address from params
    const walletAddress = request.params.wallet;
    if (!walletAddress) {
      throw new UnauthorizedError('Wallet address required');
    }

    validateAddress(walletAddress);

    // Get stored nonce
    const nonceData = getNonce(walletAddress);
    if (!nonceData) {
      throw new UnauthorizedError('No nonce found. Request a new nonce first.');
    }

    // Check if nonce is expired
    if (Date.now() > nonceData.expiresAt) {
      deleteNonce(walletAddress);
      throw new UnauthorizedError('Nonce expired. Request a new nonce.');
    }

    // Verify signature
    const message = {
      wallet: walletAddress as `0x${string}`,
      nonce: nonceData.nonce,
      timestamp: BigInt(nonceData.timestamp),
    };

    await verifySignInSignature(message, signature, walletAddress as `0x${string}`);

    // Signature is valid - continue
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }
    throw new UnauthorizedError('Authentication failed');
  }
}
