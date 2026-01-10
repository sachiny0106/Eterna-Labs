import express, { Application } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import path from 'path';

import config from './config/index';
import { logger } from './utils/index';
import { TokenAggregator } from './services/index';
import { WebSocketServer } from './websocket/index';
import { UpdateScheduler } from './scheduler/index';
import {
  createTokenRoutes,
  createHealthRoutes,
  errorHandler,
  notFoundHandler,
  requestLogger,
} from './api/index';

/**
 * Main application class
 * 
 * Sets up express, websocket, scheduler, and all the routes.
 * Pretty straightforward stuff.
 */
class App {
  private app: Application;
  private httpServer: ReturnType<typeof createServer>;
  private aggregator: TokenAggregator;
  private wsServer: WebSocketServer;
  private scheduler: UpdateScheduler;

  constructor() {
    this.app = express();
    this.httpServer = createServer(this.app);
    this.aggregator = new TokenAggregator();
    this.wsServer = new WebSocketServer(this.httpServer);
    this.scheduler = new UpdateScheduler(this.aggregator, this.wsServer);

    this.setupMiddleware();
    this.setupRoutes();
    this.setupEventHandlers();
  }

  private setupMiddleware(): void {
    // cors - allow everything for now
    this.app.use(cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }));

    // body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // log requests
    this.app.use(requestLogger);

    // rate limit api routes
    const limiter = rateLimit({
      windowMs: 60 * 1000, // 1 min
      max: 100, // 100 req/min
      message: {
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests, please try again later',
        },
      },
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use('/api', limiter);

    // serve frontend
    this.app.use(express.static(path.join(__dirname, '../public')));
  }

  private setupRoutes(): void {
    // api routes
    this.app.use('/api/tokens', createTokenRoutes(this.aggregator));
    this.app.use('/api/health', createHealthRoutes(this.aggregator, this.wsServer));

    // root - just returns some info
    this.app.get('/', (req, res) => {
      res.json({
        name: 'Meme Coin Aggregator',
        version: '1.0.0',
        description: 'Real-time meme coin data aggregation service',
        endpoints: {
          tokens: '/api/tokens',
          search: '/api/tokens/search?q={query}',
          trending: '/api/tokens/trending/list',
          gainers: '/api/tokens/gainers/list',
          losers: '/api/tokens/losers/list',
          health: '/api/health',
          stats: '/api/health/stats',
        },
        websocket: {
          url: `ws://localhost:${config.port}`,
          events: ['price_update', 'volume_spike', 'new_token', 'batch_update'],
        },
        documentation: 'https://github.com/yourusername/meme-coin-aggregator',
      });
    });

    // error handlers
    this.app.use(notFoundHandler);
    this.app.use(errorHandler);
  }

  // hook up ws event broadcasting
  private setupEventHandlers(): void {
    this.aggregator.setEventHandlers({
      onPriceUpdate: (data) => {
        this.wsServer.broadcastPriceUpdate(data);
      },
      onVolumeSpike: (data) => {
        this.wsServer.broadcastVolumeSpike(data);
      },
      onNewToken: (token) => {
        this.wsServer.broadcastNewToken(token);
      },
    });
  }

  async start(): Promise<void> {
    try {
      logger.info('Starting Meme Coin Aggregator...');
      logger.info(`Environment: ${config.nodeEnv}`);

      // load initial data
      await this.aggregator.initialize();

      // start scheduler
      this.scheduler.start();

      // start server
      this.httpServer.listen(config.port, () => {
        logger.info(`Server is running on port ${config.port}`);
        logger.info(`REST API: http://localhost:${config.port}/api`);
        logger.info(`WebSocket: ws://localhost:${config.port}`);
        logger.info(`Health check: http://localhost:${config.port}/api/health`);
      });

      this.setupGracefulShutdown();

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to start server:', msg);
      process.exit(1);
    }
  }

  // handle shutdown signals
  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);

      this.scheduler.stop();
      await this.wsServer.shutdown();

      this.httpServer.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });

      // force exit after 10s if something hangs
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    process.on('uncaughtException', (error) => {
      const msg = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : '';
      logger.error(`Uncaught Exception: ${msg}`);
      if (stack) logger.error(`Stack: ${stack}`);
      shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason) => {
      const msg = reason instanceof Error ? reason.message : String(reason);
      const stack = reason instanceof Error ? reason.stack : '';
      logger.error(`Unhandled Rejection: ${msg}`);
      if (stack) logger.error(`Stack: ${stack}`);
    });
  }
}

// start the app
const app = new App();
app.start();
