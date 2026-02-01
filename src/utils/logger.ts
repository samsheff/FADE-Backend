import pino from 'pino';
import { getEnvironment } from '../config/environment.js';

let logger: pino.Logger;

export function createLogger(): pino.Logger {
  const env = getEnvironment();

  logger = pino({
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
  });

  return logger;
}

export function getLogger(): pino.Logger {
  if (!logger) {
    throw new Error('Logger not initialized. Call createLogger() first.');
  }
  return logger;
}
