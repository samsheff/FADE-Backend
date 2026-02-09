import pino from 'pino';
import { getEnvironment } from '../config/environment.js';

let _logger: pino.Logger | undefined;

export function createLogger(): pino.Logger {
  const env = getEnvironment();

  _logger = pino({
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

  return _logger;
}

export function getLogger(): pino.Logger {
  if (!_logger) {
    throw new Error('Logger not initialized. Call createLogger() first.');
  }
  return _logger;
}

// Export logger as a getter for backwards compatibility with existing imports
export const logger = new Proxy({} as pino.Logger, {
  get(_target, prop) {
    if (!_logger) {
      throw new Error('Logger not initialized. Call createLogger() first.');
    }
    return (_logger as any)[prop];
  },
  set(_target, prop, value) {
    if (!_logger) {
      throw new Error('Logger not initialized. Call createLogger() first.');
    }
    (_logger as any)[prop] = value;
    return true;
  }
});
