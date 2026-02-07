import { FastifyInstance } from 'fastify';
import { SignalService } from '../../services/signals/signal.service.js';

export async function signalsRoutes(app: FastifyInstance): Promise<void> {
  const signalService = new SignalService();

  app.get<{
    Querystring: {
      instrumentId?: string;
      signalType?: string;
      severity?: string;
      minScore?: number;
      limit?: number;
      offset?: number;
    };
  }>(
    '/',
    {
      schema: {
        tags: ['signals'],
        description: 'List signals with optional filters',
        querystring: {
          type: 'object',
          properties: {
            instrumentId: { type: 'string' },
            signalType: {
              type: 'string',
              enum: ['DILUTION_RISK', 'TOXIC_FINANCING_RISK', 'DISTRESS_RISK', 'VOLATILITY_SPIKE'],
            },
            severity: {
              type: 'string',
              enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
            },
            minScore: { type: 'number' },
            limit: { type: 'number', default: 20 },
            offset: { type: 'number', default: 0 },
          },
        },
      },
    },
    async (request) => {
      return signalService.findSignals(request.query as any);
    },
  );

  app.get(
    '/toxic-financing',
    {
      schema: {
        tags: ['signals'],
        description: 'Get toxic financing candidates (HIGH/CRITICAL severity)',
      },
    },
    async () => {
      return signalService.getToxicFinancingCandidates();
    },
  );

  app.get(
    '/dilution-risk',
    {
      schema: {
        tags: ['signals'],
        description: 'Get dilution risk candidates (HIGH/CRITICAL severity)',
      },
    },
    async () => {
      return signalService.getDilutionRiskCandidates();
    },
  );

  app.get(
    '/distress-risk',
    {
      schema: {
        tags: ['signals'],
        description: 'Get financial distress risk candidates (MEDIUM+ severity)',
      },
    },
    async () => {
      return signalService.getDistressRiskCandidates();
    },
  );

  app.get(
    '/statistics',
    {
      schema: {
        tags: ['signals'],
        description: 'Get signal statistics',
      },
    },
    async () => {
      return signalService.getSignalStatistics();
    },
  );
}
