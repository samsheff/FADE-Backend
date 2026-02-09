import { FastifyInstance } from 'fastify';
import { TradeExecutionService } from '../../services/trade-execution/trade-execution.service.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { PrepareTradeRequest, PrepareTradeResponse } from '../../types/trade.types.js';

export async function prepareTradeRoutes(app: FastifyInstance): Promise<void> {
  const tradeService = new TradeExecutionService();

  app.post<{
    Body: PrepareTradeRequest & { walletAddress: string };
  }>(
    '/prepare',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['trades'],
        description: 'Prepare an unsigned trade transaction (requires authentication)',
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
        body: {
          type: 'object',
          required: ['walletAddress', 'marketId', 'outcome', 'side', 'size'],
          properties: {
            walletAddress: { type: 'string', description: 'Wallet address making the trade' },
            marketId: { type: 'string', description: 'Market condition ID' },
            outcome: {
              type: 'string',
              enum: ['YES', 'NO'],
              description: 'Outcome to trade',
            },
            side: {
              type: 'string',
              enum: ['buy', 'sell'],
              description: 'Buy or sell',
            },
            size: { type: 'string', description: 'Size in outcome tokens' },
            orderType: {
              type: 'string',
              enum: ['market', 'limit'],
              description: 'Order type (default: market)',
            },
            limitPrice: { type: 'string', description: 'Limit price (required for limit orders)' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              unsignedTx: {
                type: 'object',
                properties: {
                  to: { type: 'string' },
                  data: { type: 'string' },
                  value: { type: 'string' },
                  chainId: { type: 'number' },
                  gasLimit: { type: 'string' },
                },
              },
              estimatedCost: { type: 'string' },
              slippageEstimate: { type: 'string' },
            },
          },
        },
      },
    },
    async (request): Promise<PrepareTradeResponse> => {
      const { walletAddress, marketId, outcome, side, size, orderType, limitPrice } = request.body;

      const response = await tradeService.prepareTrade(walletAddress, {
        marketId,
        outcome,
        side,
        size,
        orderType,
        limitPrice,
      });

      // Convert bigint to string for JSON serialization
      return {
        unsignedTx: {
          ...response.unsignedTx,
          value: response.unsignedTx.value.toString() as unknown as bigint,
          gasLimit: response.unsignedTx.gasLimit.toString() as unknown as bigint,
        },
        estimatedCost: response.estimatedCost,
        slippageEstimate: response.slippageEstimate,
      };
    },
  );
}
