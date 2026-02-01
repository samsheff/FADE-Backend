import { FastifyInstance } from 'fastify';
import { storeNonce } from '../../middleware/auth.middleware.js';
import { generateNonce, formatSignInMessage } from '../../utils/signature-verification.js';
import { validateAddress } from '../../utils/validators.js';
import { NonceResponse } from '../../types/auth.types.js';

export async function nonceRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: { wallet: string };
  }>(
    '/nonce',
    {
      schema: {
        tags: ['auth'],
        description: 'Request a nonce for EIP-712 signature',
        querystring: {
          type: 'object',
          required: ['wallet'],
          properties: {
            wallet: { type: 'string', description: 'Wallet address' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              nonce: { type: 'string' },
              timestamp: { type: 'number' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request): Promise<NonceResponse> => {
      const { wallet } = request.query;

      // Validate address
      validateAddress(wallet);

      // Generate nonce and timestamp
      const nonce = generateNonce();
      const timestamp = Math.floor(Date.now() / 1000);

      // Store nonce
      storeNonce(wallet, nonce, timestamp);

      // Format message for signing
      const message = formatSignInMessage(wallet, nonce, timestamp);

      return {
        nonce,
        timestamp,
        message,
      };
    },
  );
}
