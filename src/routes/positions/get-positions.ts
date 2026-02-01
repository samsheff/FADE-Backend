import { FastifyInstance } from 'fastify';
import { PositionTrackingService } from '../../services/position-tracking/position-tracking.service.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { PositionListResponse } from '../../types/position.types.js';

export async function getPositionsRoutes(app: FastifyInstance): Promise<void> {
  const positionService = new PositionTrackingService();

  app.get<{
    Params: { wallet: string };
  }>(
    '/:wallet',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['positions'],
        description: 'Get positions for a wallet (requires authentication)',
        params: {
          type: 'object',
          required: ['wallet'],
          properties: {
            wallet: { type: 'string', description: 'Wallet address' },
          },
        },
        headers: {
          type: 'object',
          required: ['authorization'],
          properties: {
            authorization: {
              type: 'string',
              description: 'Bearer token with EIP-712 signature',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              positions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    walletAddress: { type: 'string' },
                    marketId: { type: 'string' },
                    outcome: { type: 'string' },
                    avgPrice: { type: 'string' },
                    size: { type: 'string' },
                    realizedPnl: { type: 'string' },
                    unrealizedPnl: { type: 'string' },
                    lastTradeAt: { type: 'string' },
                    updatedAt: { type: 'string' },
                  },
                },
              },
              totalPnl: { type: 'string' },
            },
          },
        },
      },
    },
    async (request): Promise<PositionListResponse> => {
      const { wallet } = request.params;
      return await positionService.getPositions(wallet);
    },
  );
}
