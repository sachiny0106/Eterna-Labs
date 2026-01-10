import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import config from '../config/index';
import { logger } from '../utils/index';
import type {
  WebSocketEventType,
  WebSocketMessage,
  PriceUpdateData,
  VolumeSpikeData,
  Token,
  TokenFilter,
  TokenSort,
} from '../types/index';

interface ClientSubscription {
  filters?: TokenFilter;
  sort?: TokenSort;
  tokens?: string[]; // specific tokens to watch
}

interface ConnectedClient {
  socket: Socket;
  subscription: ClientSubscription;
  subscribedAt: Date;
}

/**
 * WebSocket server for real-time updates
 * 
 * Handles connections, subscriptions, and broadcasting events
 * to connected clients. Uses socket.io for the heavy lifting.
 */
export class WebSocketServer {
  private io: Server;
  private clients: Map<string, ConnectedClient> = new Map();
  private connectionCount: number = 0;

  constructor(httpServer: HttpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: '*', // TODO: lock this down in prod
        methods: ['GET', 'POST'],
      },
      pingInterval: config.wsPingInterval,
      pingTimeout: config.wsPingTimeout,
      transports: ['websocket', 'polling'],
    });

    this.setupEventHandlers();
    logger.info('WebSocket server initialized');
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      this.handleConnection(socket);

      socket.on('subscribe', (data: ClientSubscription) => {
        this.handleSubscribe(socket, data);
      });

      socket.on('unsubscribe', () => {
        this.handleUnsubscribe(socket);
      });

      socket.on('ping', () => {
        socket.emit('pong', { timestamp: new Date().toISOString() });
      });

      socket.on('disconnect', (reason) => {
        this.handleDisconnect(socket, reason);
      });

      socket.on('error', (error) => {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`WebSocket error for client ${socket.id}: ${msg}`);
      });
    });
  }

  // new client connected
  private handleConnection(socket: Socket): void {
    this.connectionCount++;

    const client: ConnectedClient = {
      socket,
      subscription: {},
      subscribedAt: new Date(),
    };

    this.clients.set(socket.id, client);
    logger.info(`Client connected: ${socket.id} (Total: ${this.clients.size})`);

    // send welcome message
    this.sendToClient(socket, {
      event: 'connected' as WebSocketEventType,
      data: {
        clientId: socket.id,
        message: 'Connected to meme coin aggregator',
        serverTime: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    });
  }

  // client wants to subscribe to specific tokens or filters
  private handleSubscribe(socket: Socket, data: ClientSubscription): void {
    const client = this.clients.get(socket.id);

    if (client) {
      client.subscription = data;
      logger.debug(`Client ${socket.id} subscribed:`, data);

      this.sendToClient(socket, {
        event: 'subscribed' as WebSocketEventType,
        data: {
          filters: data.filters,
          sort: data.sort,
          tokens: data.tokens,
          message: 'Subscription updated',
        },
        timestamp: new Date().toISOString(),
      });
    }
  }

  private handleUnsubscribe(socket: Socket): void {
    const client = this.clients.get(socket.id);

    if (client) {
      client.subscription = {};
      logger.debug(`Client ${socket.id} unsubscribed`);

      this.sendToClient(socket, {
        event: 'unsubscribed' as WebSocketEventType,
        data: { message: 'Unsubscribed from all updates' },
        timestamp: new Date().toISOString(),
      });
    }
  }

  private handleDisconnect(socket: Socket, reason: string): void {
    this.clients.delete(socket.id);
    logger.info(`Client disconnected: ${socket.id} (Reason: ${reason}, Remaining: ${this.clients.size})`);
  }

  // broadcast price update to clients
  broadcastPriceUpdate(data: PriceUpdateData): void {
    const message: WebSocketMessage<PriceUpdateData> = {
      event: 'price_update' as WebSocketEventType,
      data,
      timestamp: new Date().toISOString(),
    };

    let sentCount = 0;

    for (const [clientId, client] of this.clients) {
      if (this.shouldReceiveUpdate(client.subscription, data.token_address)) {
        this.sendToClient(client.socket, message);
        sentCount++;
      }
    }

    logger.debug(`Price update broadcasted to ${sentCount} clients for ${data.token_address}`);
  }

  // volume spike notification
  broadcastVolumeSpike(data: VolumeSpikeData): void {
    const message: WebSocketMessage<VolumeSpikeData> = {
      event: 'volume_spike' as WebSocketEventType,
      data,
      timestamp: new Date().toISOString(),
    };

    let sentCount = 0;

    for (const [clientId, client] of this.clients) {
      if (this.shouldReceiveUpdate(client.subscription, data.token_address)) {
        this.sendToClient(client.socket, message);
        sentCount++;
      }
    }

    logger.debug(`Volume spike broadcasted to ${sentCount} clients for ${data.token_ticker}`);
  }

  // new token discovered - send to everyone
  broadcastNewToken(token: Token): void {
    const message: WebSocketMessage<Token> = {
      event: 'new_token' as WebSocketEventType,
      data: token,
      timestamp: new Date().toISOString(),
    };

    this.io.emit('new_token', message);
    logger.debug(`New token broadcasted: ${token.token_ticker}`);
  }

  // batch update - respects client filters
  broadcastBatchUpdate(tokens: Token[]): void {
    const message: WebSocketMessage<{ tokens: Token[]; count: number }> = {
      event: 'batch_update' as WebSocketEventType,
      data: {
        tokens,
        count: tokens.length,
      },
      timestamp: new Date().toISOString(),
    };

    for (const [clientId, client] of this.clients) {
      const filteredTokens = this.filterTokensForClient(tokens, client.subscription);

      if (filteredTokens.length > 0) {
        this.sendToClient(client.socket, {
          ...message,
          data: {
            tokens: filteredTokens,
            count: filteredTokens.length,
          },
        });
      }
    }

    logger.debug(`Batch update broadcasted: ${tokens.length} tokens`);
  }

  // check if client cares about this token
  private shouldReceiveUpdate(subscription: ClientSubscription, tokenAddress: string): boolean {
    if (!subscription.tokens || subscription.tokens.length === 0) {
      return true; // no filter = get everything
    }
    return subscription.tokens.includes(tokenAddress);
  }

  // filter tokens based on client subscription
  private filterTokensForClient(tokens: Token[], subscription: ClientSubscription): Token[] {
    if (!subscription.filters && !subscription.tokens) {
      return tokens;
    }

    return tokens.filter(token => {
      // check token whitelist
      if (subscription.tokens && subscription.tokens.length > 0) {
        if (!subscription.tokens.includes(token.token_address)) {
          return false;
        }
      }

      // apply filters
      const filters = subscription.filters;
      if (filters) {
        if (filters.minVolume && token.volume_usd < filters.minVolume) return false;
        if (filters.maxVolume && token.volume_usd > filters.maxVolume) return false;
        if (filters.minMarketCap && token.market_cap_usd < filters.minMarketCap) return false;
        if (filters.minLiquidity && token.liquidity_usd < filters.minLiquidity) return false;
        if (filters.protocol && token.protocol.toLowerCase() !== filters.protocol.toLowerCase()) return false;
      }

      return true;
    });
  }

  private sendToClient<T>(socket: Socket, message: WebSocketMessage<T>): void {
    try {
      socket.emit(message.event, message);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to send message to client ${socket.id}: ${msg}`);
    }
  }

  // broadcast error to all clients
  broadcastError(error: { code: string; message: string }): void {
    const message: WebSocketMessage<{ code: string; message: string }> = {
      event: 'error' as WebSocketEventType,
      data: error,
      timestamp: new Date().toISOString(),
    };

    this.io.emit('error', message);
  }

  // get connection stats
  getStats(): {
    activeConnections: number;
    totalConnections: number;
    subscriptions: number;
  } {
    let subscriptionsCount = 0;
    for (const client of this.clients.values()) {
      if (client.subscription.tokens?.length || client.subscription.filters) {
        subscriptionsCount++;
      }
    }

    return {
      activeConnections: this.clients.size,
      totalConnections: this.connectionCount,
      subscriptions: subscriptionsCount,
    };
  }

  getIO(): Server {
    return this.io;
  }

  // graceful shutdown
  async shutdown(): Promise<void> {
    logger.info('Shutting down WebSocket server...');

    // notify all clients
    this.io.emit('server_shutdown', {
      message: 'Server is shutting down',
      timestamp: new Date().toISOString(),
    });

    // close all connections
    for (const [clientId, client] of this.clients) {
      client.socket.disconnect(true);
    }

    this.clients.clear();

    await new Promise<void>((resolve) => {
      this.io.close(() => {
        logger.info('WebSocket server closed');
        resolve();
      });
    });
  }
}

export default WebSocketServer;
