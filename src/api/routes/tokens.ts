import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { TokenAggregator } from '../../services';
import config from '../../config';
import type { TokenFilter, TokenSort, PaginationOptions, ApiResponse, Token } from '../../types';

// Token routes
export function createTokenRoutes(aggregator: TokenAggregator): Router {
  const router = Router();

  // GET /api/tokens - list with filters
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = uuidv4();
    const startTime = Date.now();

    try {
      // Parse query parameters
      const filter: TokenFilter = {
        timePeriod: req.query.time_period as '1h' | '24h' | '7d' | undefined,
        minVolume: req.query.min_volume ? parseFloat(req.query.min_volume as string) : undefined,
        maxVolume: req.query.max_volume ? parseFloat(req.query.max_volume as string) : undefined,
        minMarketCap: req.query.min_market_cap ? parseFloat(req.query.min_market_cap as string) : undefined,
        maxMarketCap: req.query.max_market_cap ? parseFloat(req.query.max_market_cap as string) : undefined,
        minLiquidity: req.query.min_liquidity ? parseFloat(req.query.min_liquidity as string) : undefined,
        protocol: req.query.protocol as string | undefined,
        chain: req.query.chain as string | undefined,
        search: req.query.search as string | undefined,
      };

      // Remove undefined values
      const cleanFilter: TokenFilter = Object.fromEntries(
        Object.entries(filter).filter(([_, v]) => v !== undefined)
      ) as TokenFilter;

      const timePeriod = req.query.time_period as '1h' | '24h' | '7d' | undefined;

      const sort: TokenSort | undefined = req.query.sort_by
        ? {
          field: req.query.sort_by as TokenSort['field'],
          direction: (req.query.sort_dir as 'asc' | 'desc') || 'desc',
          timePeriod,
        }
        : undefined;

      const pagination: PaginationOptions = {
        limit: Math.min(
          parseInt(req.query.limit as string) || config.defaultPageSize,
          config.maxPageSize
        ),
        cursor: req.query.cursor as string | undefined,
      };

      const result = await aggregator.getTokens(
        Object.keys(cleanFilter).length > 0 ? cleanFilter : undefined,
        sort,
        pagination
      );

      const response: ApiResponse<typeof result> = {
        success: true,
        data: result,
        meta: {
          timestamp: new Date().toISOString(),
          request_id: requestId,
          response_time_ms: Date.now() - startTime,
        },
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  // GET /api/tokens/search - search by name/ticker
  router.get('/search', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = uuidv4();
    const startTime = Date.now();

    try {
      const query = req.query.q as string;

      if (!query || query.length < 1) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_QUERY',
            message: 'Search query must be at least 1 character',
          },
          meta: {
            timestamp: new Date().toISOString(),
            request_id: requestId,
            response_time_ms: Date.now() - startTime,
          },
        });
        return;
      }

      const limit = Math.min(
        parseInt(req.query.limit as string) || 20,
        config.maxPageSize
      );

      const tokens = await aggregator.searchTokens(query, limit);

      const response: ApiResponse<{ tokens: Token[]; count: number }> = {
        success: true,
        data: {
          tokens,
          count: tokens.length,
        },
        meta: {
          timestamp: new Date().toISOString(),
          request_id: requestId,
          response_time_ms: Date.now() - startTime,
        },
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  // GET /api/tokens/:address - get one token
  router.get('/:address', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = uuidv4();
    const startTime = Date.now();

    try {
      const { address } = req.params;

      if (!address || address.length < 32) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_ADDRESS',
            message: 'Invalid token address format',
          },
          meta: {
            timestamp: new Date().toISOString(),
            request_id: requestId,
            response_time_ms: Date.now() - startTime,
          },
        });
        return;
      }

      const token = await aggregator.getTokenByAddress(address);

      if (!token) {
        res.status(404).json({
          success: false,
          error: {
            code: 'TOKEN_NOT_FOUND',
            message: `Token with address ${address} not found`,
          },
          meta: {
            timestamp: new Date().toISOString(),
            request_id: requestId,
            response_time_ms: Date.now() - startTime,
          },
        });
        return;
      }

      const response: ApiResponse<Token> = {
        success: true,
        data: token,
        meta: {
          timestamp: new Date().toISOString(),
          request_id: requestId,
          response_time_ms: Date.now() - startTime,
        },
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  // POST /api/tokens/batch - get multiple tokens
  router.post('/batch', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = uuidv4();
    const startTime = Date.now();

    try {
      const { addresses } = req.body;

      if (!Array.isArray(addresses) || addresses.length === 0) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Request body must contain an array of addresses',
          },
          meta: {
            timestamp: new Date().toISOString(),
            request_id: requestId,
            response_time_ms: Date.now() - startTime,
          },
        });
        return;
      }

      if (addresses.length > 100) {
        res.status(400).json({
          success: false,
          error: {
            code: 'TOO_MANY_ADDRESSES',
            message: 'Maximum 100 addresses per request',
          },
          meta: {
            timestamp: new Date().toISOString(),
            request_id: requestId,
            response_time_ms: Date.now() - startTime,
          },
        });
        return;
      }

      const tokens: Token[] = [];
      const notFound: string[] = [];

      for (const address of addresses) {
        const token = await aggregator.getTokenByAddress(address);
        if (token) {
          tokens.push(token);
        } else {
          notFound.push(address);
        }
      }

      const response: ApiResponse<{ tokens: Token[]; not_found: string[] }> = {
        success: true,
        data: {
          tokens,
          not_found: notFound,
        },
        meta: {
          timestamp: new Date().toISOString(),
          request_id: requestId,
          response_time_ms: Date.now() - startTime,
        },
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  // GET /api/tokens/trending/list - hot tokens
  router.get('/trending/list', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = uuidv4();
    const startTime = Date.now();

    try {
      const limit = Math.min(
        parseInt(req.query.limit as string) || 20,
        50
      );

      const result = await aggregator.getTokens(
        { minVolume: 1000 }, // Minimum $1000 volume
        { field: 'volume', direction: 'desc' },
        { limit }
      );

      const response: ApiResponse<typeof result> = {
        success: true,
        data: result,
        meta: {
          timestamp: new Date().toISOString(),
          request_id: requestId,
          response_time_ms: Date.now() - startTime,
        },
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  // GET /api/tokens/gainers/list - top gainers
  router.get('/gainers/list', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = uuidv4();
    const startTime = Date.now();

    try {
      const limit = Math.min(
        parseInt(req.query.limit as string) || 20,
        50
      );

      const timePeriod = (req.query.time_period as '1h' | '24h' | '7d') || '24h';

      const result = await aggregator.getTokens(
        { timePeriod, minVolume: 100 },
        { field: 'price_change', direction: 'desc' },
        { limit }
      );

      const response: ApiResponse<typeof result> = {
        success: true,
        data: result,
        meta: {
          timestamp: new Date().toISOString(),
          request_id: requestId,
          response_time_ms: Date.now() - startTime,
        },
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  // GET /api/tokens/losers/list - top losers
  router.get('/losers/list', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = uuidv4();
    const startTime = Date.now();

    try {
      const limit = Math.min(
        parseInt(req.query.limit as string) || 20,
        50
      );

      const timePeriod = (req.query.time_period as '1h' | '24h' | '7d') || '24h';

      const result = await aggregator.getTokens(
        { timePeriod, minVolume: 100 },
        { field: 'price_change', direction: 'asc' },
        { limit }
      );

      const response: ApiResponse<typeof result> = {
        success: true,
        data: result,
        meta: {
          timestamp: new Date().toISOString(),
          request_id: requestId,
          response_time_ms: Date.now() - startTime,
        },
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export default createTokenRoutes;
