import type { Request, Response, NextFunction } from 'express';
import type { ApiErrorResponse } from '../types/api.types';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// Central error handler — keeps controllers clean and ensures we never
// accidentally leak Square API error details or stack traces to clients
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    const body: ApiErrorResponse = {
      success: false,
      error: { code: err.code, message: err.message },
    };
    res.status(err.statusCode).json(body);
    return;
  }

  // Log unexpected errors server-side but don't expose internals
  console.error('[Unhandled error]', err);

  const isSquareRateLimit = err instanceof Error && err.message.includes('429');

  if (isSquareRateLimit) {
    const body: ApiErrorResponse = {
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please try again in a moment.',
      },
    };
    res.status(429).json(body);
    return;
  }

  const body: ApiErrorResponse = {
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
    },
  };
  res.status(500).json(body);
}
