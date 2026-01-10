import express from 'express';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import { io as ioc, Socket as ClientSocket } from 'socket.io-client';
import { WebSocketServer } from '../../src/websocket/server';

describe('WebSocket Server', () => {
  let httpServer: ReturnType<typeof createServer>;
  let wsServer: WebSocketServer;
  let port: number;

  beforeAll((done) => {
    const app = express();
    httpServer = createServer(app);
    wsServer = new WebSocketServer(httpServer);
    httpServer.listen(0, () => {
      port = (httpServer.address() as AddressInfo).port;
      done();
    });
  });

  afterAll(async () => {
    await wsServer.shutdown();
    httpServer.close();
  });

  // Helper to create connected client
  const createClient = (): Promise<ClientSocket> => {
    return new Promise((resolve) => {
      const client = ioc(`http://localhost:${port}`, { 
        transports: ['websocket'], 
        forceNew: true 
      });
      client.on('connect', () => resolve(client));
    });
  };

  it('responds to ping with pong', async () => {
    const client = await createClient();
    
    const pong = await new Promise<{ timestamp: number }>((resolve) => {
      client.on('pong', resolve);
      client.emit('ping');
    });
    
    expect(pong).toHaveProperty('timestamp');
    client.disconnect();
  });

  it('handles subscribe event', async () => {
    const client = await createClient();
    
    const msg = await new Promise<{ event: string }>((resolve) => {
      client.on('subscribed', resolve);
      client.emit('subscribe', { filters: { minVolume: 1000 } });
    });
    
    expect(msg.event).toBe('subscribed');
    client.disconnect();
  });

  it('handles unsubscribe event', async () => {
    const client = await createClient();
    
    const msg = await new Promise<{ event: string }>((resolve) => {
      client.on('unsubscribed', resolve);
      client.emit('unsubscribe');
    });
    
    expect(msg.event).toBe('unsubscribed');
    client.disconnect();
  });

  it('broadcasts price updates', async () => {
    const client = await createClient();
    const update = { token_address: 'test', old_price: 1, new_price: 1.5, price_change_percent: 50 };
    
    const msg = await new Promise<{ event: string; data: { token_address: string } }>((resolve) => {
      client.on('price_update', resolve);
      setTimeout(() => wsServer.broadcastPriceUpdate(update as unknown as Parameters<typeof wsServer.broadcastPriceUpdate>[0]), 50);
    });
    
    expect(msg.event).toBe('price_update');
    expect(msg.data.token_address).toBe('test');
    client.disconnect();
  });

  it('broadcasts new tokens', async () => {
    const client = await createClient();
    const token = {
      token_address: 'new-token',
      token_name: 'New',
      token_ticker: 'NEW',
      price_sol: 0.001, price_usd: 0.2,
      market_cap_sol: 0, market_cap_usd: 0,
      volume_sol: 0, volume_usd: 0,
      liquidity_sol: 0, liquidity_usd: 0,
      transaction_count: 0,
      price_1hr_change: 0, price_24hr_change: 0, price_7d_change: 0,
      volume_1hr: 0, volume_24hr: 0, volume_7d: 0,
      protocol: 'test', dex_id: 'test', chain_id: 'solana',
      pair_address: 'pair', created_at: new Date().toISOString(),
      last_updated: new Date().toISOString(), sources: ['test']
    };
    
    const msg = await new Promise<{ event: string }>((resolve) => {
      client.on('new_token', resolve);
      setTimeout(() => wsServer.broadcastNewToken(token), 50);
    });
    
    expect(msg.event).toBe('new_token');
    client.disconnect();
  });

  it('tracks connection stats', () => {
    const stats = wsServer.getStats();
    expect(stats).toHaveProperty('activeConnections');
    expect(stats).toHaveProperty('totalConnections');
  });
});
