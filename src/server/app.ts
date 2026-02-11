import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { getEnvironment } from '../config/environment.js';
import { AppError } from '../utils/errors.js';
import type { ZodError } from 'zod';

export async function createApp(): Promise<FastifyInstance> {
  const env = getEnvironment();

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'HH:MM:ss',
                ignore: 'pid,hostname',
              },
            }
          : undefined,
    },
    requestIdLogLabel: 'reqId',
    disableRequestLogging: false,
    requestIdHeader: 'x-request-id',
  });

  // CORS plugin
  await app.register(cors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
    credentials: true,
  });

  // Rate limiting plugin
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    errorResponseBuilder: () => {
      return {
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests',
        },
      };
    },
  });

  // Swagger documentation
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Polymarket Terminal API',
        description: 'Deterministic backend for Polymarket prediction market trading',
        version: '1.0.0',
      },
      servers: [
        {
          url: `http://localhost:${env.PORT}`,
          description: 'Development server',
        },
      ],
      tags: [
        { name: 'health', description: 'Health check endpoints' },
        { name: 'auth', description: 'Authentication endpoints' },
        { name: 'markets', description: 'Market data endpoints' },
        { name: 'positions', description: 'Position tracking endpoints' },
        { name: 'trades', description: 'Trade execution endpoints' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/documentation',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  });

  // Global error handler
  app.setErrorHandler((error, request, reply) => {
    const { log } = request;

    // Handle AppError instances
    if (error instanceof AppError) {
      log.warn({ err: error }, 'Application error');
      return reply.status(error.statusCode).send(error.toJSON());
    }

    // Handle Zod validation errors
    if (error.name === 'ZodError') {
      const zodError = error as ZodError;
      log.warn({ err: zodError }, 'Validation error');
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: zodError.errors,
        },
      });
    }

    // Handle Fastify validation errors
    if (error.validation) {
      log.warn({ err: error }, 'Fastify validation error');
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
          details: error.validation,
        },
      });
    }

    // Log unexpected errors
    log.error({ err: error }, 'Unexpected error');

    // Don't expose internal errors in production
    if (env.NODE_ENV === 'production') {
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }

    // In development, send full error details
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error.message,
        stack: error.stack,
      },
    });
  });

  return app;
}
