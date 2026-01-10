import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils';

// Simple API error with status code
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Log each request with timing
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const id = uuidv4();
  (req as any).requestId = id;

  res.on('finish', () => {
    logger.info(`${req.method} ${req.path} ${res.statusCode} - ${Date.now() - start}ms`);
  });
  next();
}

// 404 handler
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` }
  });
}

// Global error handler - catches everything
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  logger.error('Error:', err.message);

  // Known API errors
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message }
    });
    return;
  }

  // Bad JSON
  if (err.name === 'SyntaxError') {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_JSON', message: 'Invalid JSON in request body' }
    });
    return;
  }

  // Unknown error - don't leak details
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' }
  });
}

export default errorHandler;
