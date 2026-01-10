import cron from 'node-cron';
import config from '../config/index';
import { TokenAggregator } from '../services/index';
import { WebSocketServer } from '../websocket/index';
import { logger } from '../utils/index';

/**
 * Scheduler for periodic data updates
 * 
 * Runs cron jobs to:
 * - refresh prices every X seconds (default 10s)
 * - do full data refresh every Y seconds (default 60s)
 * - update SOL price every 30s
 */
export class UpdateScheduler {
  private aggregator: TokenAggregator;
  private wsServer: WebSocketServer;
  private priceUpdateJob: cron.ScheduledTask | null = null;
  private fullRefreshJob: cron.ScheduledTask | null = null;
  private solPriceJob: cron.ScheduledTask | null = null;
  private isRunning: boolean = false;

  constructor(aggregator: TokenAggregator, wsServer: WebSocketServer) {
    this.aggregator = aggregator;
    this.wsServer = wsServer;
  }

  start(): void {
    if (this.isRunning) {
      logger.warn('Scheduler is already running');
      return;
    }

    logger.info('Starting update scheduler...');

    // price updates - sends batch to websocket clients
    const priceInterval = config.priceUpdateInterval;
    const priceExpression = `*/${priceInterval} * * * * *`;

    this.priceUpdateJob = cron.schedule(priceExpression, async () => {
      await this.runPriceUpdate();
    });

    // full refresh - hits all APIs again
    const fullRefreshInterval = config.fullRefreshInterval;
    const fullRefreshExpression = `*/${fullRefreshInterval} * * * * *`;

    this.fullRefreshJob = cron.schedule(fullRefreshExpression, async () => {
      await this.runFullRefresh();
    });

    // sol price update - every 30s
    this.solPriceJob = cron.schedule('*/30 * * * * *', async () => {
      await this.updateSolPrice();
    });

    this.isRunning = true;
    logger.info(`Scheduler started: price updates every ${priceInterval}s, full refresh every ${fullRefreshInterval}s`);
  }

  stop(): void {
    if (!this.isRunning) {
      logger.warn('Scheduler is not running');
      return;
    }

    logger.info('Stopping update scheduler...');

    this.priceUpdateJob?.stop();
    this.fullRefreshJob?.stop();
    this.solPriceJob?.stop();

    this.priceUpdateJob = null;
    this.fullRefreshJob = null;
    this.solPriceJob = null;

    this.isRunning = false;
    logger.info('Scheduler stopped');
  }

  // quick price broadcast to ws clients
  private async runPriceUpdate(): Promise<void> {
    try {
      logger.debug('Running price update...');

      const tokens = this.aggregator.getAllTokensArray();

      if (tokens.length > 0) {
        // just send top 50 to avoid huge payloads
        this.wsServer.broadcastBatchUpdate(tokens.slice(0, 50));
      }

      logger.debug(`Price update completed, ${tokens.length} tokens`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Price update failed: ${msg}`);
    }
  }

  // full data refresh from all APIs
  private async runFullRefresh(): Promise<void> {
    try {
      logger.info('Running full data refresh...');
      await this.aggregator.refreshAllData();

      // broadcast updated data
      const tokens = this.aggregator.getAllTokensArray();
      this.wsServer.broadcastBatchUpdate(tokens);

      logger.info(`Full refresh completed, ${tokens.length} tokens`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Full refresh failed: ${msg}`);
      this.wsServer.broadcastError({
        code: 'REFRESH_FAILED',
        message: 'Failed to refresh token data',
      });
    }
  }

  private async updateSolPrice(): Promise<void> {
    try {
      await this.aggregator.updateSolPrice();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`SOL price update failed: ${msg}`);
    }
  }

  // check what jobs are running (for health endpoint)
  getStatus(): {
    running: boolean;
    jobs: { name: string; running: boolean }[];
  } {
    return {
      running: this.isRunning,
      jobs: [
        { name: 'priceUpdate', running: this.priceUpdateJob !== null },
        { name: 'fullRefresh', running: this.fullRefreshJob !== null },
        { name: 'solPriceUpdate', running: this.solPriceJob !== null },
      ],
    };
  }

  // manual trigger (useful for testing)
  async triggerRefresh(): Promise<void> {
    logger.info('Manual refresh triggered');
    await this.runFullRefresh();
  }
}

export default UpdateScheduler;
