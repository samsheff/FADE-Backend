export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): {
    error: {
      code: string;
      message: string;
      details?: unknown;
    };
  } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && { details: this.details }),
      },
    };
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string) {
    const message = identifier
      ? `${resource} with identifier ${identifier} not found`
      : `${resource} not found`;
    super(message, 'NOT_FOUND', 404);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

export class BlockchainError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'BLOCKCHAIN_ERROR', 500, details);
  }
}

export class ExternalApiError extends AppError {
  constructor(service: string, message: string, details?: unknown) {
    super(`${service} API error: ${message}`, 'EXTERNAL_API_ERROR', 502, details);
  }
}

export class RateLimitError extends AppError {
  constructor() {
    super('Too many requests', 'RATE_LIMIT_EXCEEDED', 429);
  }
}

export class InsufficientLiquidityError extends AppError {
  constructor(marketId: string) {
    super(
      `Insufficient liquidity in market ${marketId}`,
      'INSUFFICIENT_LIQUIDITY',
      400,
    );
  }
}
