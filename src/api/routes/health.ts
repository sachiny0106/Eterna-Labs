import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { TokenAggregator, getCache } from '../../services';
import { WebSocketServer } from '../../websocket';
import type { HealthStatus, ApiResponse } from '../../types';

const startTime = Date.now();

// Health check endpoints
export function createHealthRoutes(
  aggregator: TokenAggregator,
  wsServer?: WebSocketServer
): Router {
  const router = Router();

  // GET /api/health - full status
  router.get('/', async (req: Request, res: Response) => {
    const requestId = uuidv4();
    const responseStartTime = Date.now();

    const cache = getCache();
    const aggStats = aggregator.getStats();
    const wsStats = wsServer?.getStats() || { activeConnections: 0, totalConnections: 0, subscriptions: 0 };

    // Determine overall status
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    if (aggStats.totalTokens === 0) {
      overallStatus = 'degraded';
    }

    if (!cache.isConnected() && !process.env.USE_MEMORY_CACHE) {
      overallStatus = 'degraded';
    }

    const health: HealthStatus = {
      status: overallStatus,
      uptime: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      services: {
        redis: {
          status: cache.isConnected() ? 'up' : 'down',
          last_check: new Date().toISOString(),
        },
        dexscreener: {
          status: aggStats.sources.includes('dexscreener') ? 'up' : 'down',
          last_check: aggStats.lastRefresh?.toISOString() || 'never',
        },
        jupiter: {
          status: aggStats.sources.includes('jupiter') ? 'up' : 'down',
          last_check: aggStats.lastRefresh?.toISOString() || 'never',
        },
        geckoterminal: {
          status: aggStats.sources.includes('geckoterminal') ? 'up' : 'down',
          last_check: aggStats.lastRefresh?.toISOString() || 'never',
        },
        websocket: {
          status: wsStats.activeConnections >= 0 ? 'up' : 'down',
          last_check: new Date().toISOString(),
        },
      },
      stats: {
        total_tokens: aggStats.totalTokens,
        active_connections: wsStats.activeConnections,
        cache_hit_rate: aggStats.cacheStats.hitRate,
        avg_response_time_ms: 0, // Would need to track this
      },
    };

    const response: ApiResponse<HealthStatus> = {
      success: true,
      data: health,
      meta: {
        timestamp: new Date().toISOString(),
        request_id: requestId,
        response_time_ms: Date.now() - responseStartTime,
      },
    };

    // Set appropriate status code
    const statusCode = overallStatus === 'healthy' ? 200 : overallStatus === 'degraded' ? 503 : 500;
    res.status(statusCode).json(response);
  });

  // GET /api/health/live - k8s liveness
  router.get('/live', (req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // GET /api/health/ready - k8s readiness
  router.get('/ready', async (req: Request, res: Response) => {
    const aggStats = aggregator.getStats();
    
    // Consider ready if we have at least some tokens
    if (aggStats.totalTokens > 0) {
      res.status(200).json({ status: 'ready', tokens: aggStats.totalTokens });
    } else {
      res.status(503).json({ status: 'not_ready', message: 'No tokens loaded yet' });
    }
  });

  // GET /api/stats - detailed stats
  router.get('/stats', async (req: Request, res: Response) => {
    const requestId = uuidv4();
    const responseStartTime = Date.now();

    const cache = getCache();
    const cacheStats = cache.getStats();
    const aggStats = aggregator.getStats();
    const wsStats = wsServer?.getStats() || { activeConnections: 0, totalConnections: 0, subscriptions: 0 };

    const stats = {
      uptime_ms: Date.now() - startTime,
      uptime_formatted: formatUptime(Date.now() - startTime),
      aggregator: {
        total_tokens: aggStats.totalTokens,
        active_sources: aggStats.sources,
        last_refresh: aggStats.lastRefresh?.toISOString() || null,
        sol_price: aggregator.getSolPrice(),
      },
      cache: {
        type: process.env.USE_MEMORY_CACHE === 'true' ? 'memory' : 'redis',
        connected: cache.isConnected(),
        hits: cacheStats.hits,
        misses: cacheStats.misses,
        hit_rate: (cacheStats.hitRate * 100).toFixed(2) + '%',
        size: cacheStats.size,
      },
      websocket: {
        active_connections: wsStats.activeConnections,
        total_connections: wsStats.totalConnections,
        active_subscriptions: wsStats.subscriptions,
      },
      config: {
        cache_ttl: process.env.CACHE_TTL || 30,
        price_update_interval: process.env.PRICE_UPDATE_INTERVAL || 10,
        full_refresh_interval: process.env.FULL_REFRESH_INTERVAL || 60,
      },
    };

    const response: ApiResponse<typeof stats> = {
      success: true,
      data: stats,
      meta: {
        timestamp: new Date().toISOString(),
        request_id: requestId,
        response_time_ms: Date.now() - responseStartTime,
      },
    };

    res.json(response);
  });

  return router;
}

// Make uptime readable
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export default createHealthRoutes;
