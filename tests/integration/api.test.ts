import express from 'express';
import request from 'supertest';
import { createTokenRoutes, createHealthRoutes } from '../../src/api/routes/index';
import { TokenAggregator } from '../../src/services/aggregator';
import { errorHandler, notFoundHandler } from '../../src/api/middleware';

// Mock the aggregator
jest.mock('../../src/services/aggregator');

describe('API Routes', () => {
  let app: express.Application;
  let mockAggregator: jest.Mocked<TokenAggregator>;

  // Use realistic Solana-style addresses for tests
  const ADDR_1 = 'So11111111111111111111111111111111111111112';
  const ADDR_2 = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

  const mockTokens = [
    {
      token_address: ADDR_1,
      token_name: 'Token One',
      token_ticker: 'TK1',
      price_sol: 0.001,
      price_usd: 0.2,
      market_cap_sol: 1000,
      market_cap_usd: 200000,
      volume_sol: 100,
      volume_usd: 20000,
      liquidity_sol: 50,
      liquidity_usd: 10000,
      transaction_count: 500,
      price_1hr_change: 5.5,
      price_24hr_change: 15.0,
      price_7d_change: 0,
      volume_1hr: 5000,
      volume_24hr: 20000,
      volume_7d: 0,
      protocol: 'raydium',
      dex_id: 'raydium',
      chain_id: 'solana',
      pair_address: 'pair-1',
      created_at: '2024-01-01T00:00:00Z',
      last_updated: new Date().toISOString(),
      sources: ['dexscreener'],
    },
    {
      token_address: ADDR_2,
      token_name: 'Token Two',
      token_ticker: 'TK2',
      price_sol: 0.002,
      price_usd: 0.4,
      market_cap_sol: 2000,
      market_cap_usd: 400000,
      volume_sol: 200,
      volume_usd: 40000,
      liquidity_sol: 100,
      liquidity_usd: 20000,
      transaction_count: 1000,
      price_1hr_change: -2.5,
      price_24hr_change: 25.0,
      price_7d_change: 0,
      volume_1hr: 10000,
      volume_24hr: 40000,
      volume_7d: 0,
      protocol: 'orca',
      dex_id: 'orca',
      chain_id: 'solana',
      pair_address: 'pair-2',
      created_at: '2024-01-02T00:00:00Z',
      last_updated: new Date().toISOString(),
      sources: ['geckoterminal'],
    },
  ];

  beforeEach(() => {
    mockAggregator = {
      getTokens: jest.fn().mockResolvedValue({
        data: mockTokens,
        pagination: {
          limit: 30,
          next_cursor: null,
          prev_cursor: null,
          total_count: mockTokens.length,
          has_more: false,
        },
        meta: {
          timestamp: new Date().toISOString(),
          cache_hit: false,
          sources: ['dexscreener', 'geckoterminal'],
        },
      }),
      getTokenByAddress: jest.fn().mockImplementation((address: string) => {
        return Promise.resolve(mockTokens.find(t => t.token_address === address) || null);
      }),
      searchTokens: jest.fn().mockResolvedValue(mockTokens),
      getStats: jest.fn().mockReturnValue({
        totalTokens: mockTokens.length,
        lastRefresh: new Date(),
        sources: ['dexscreener', 'geckoterminal'],
        cacheStats: { hits: 10, misses: 2, hitRate: 0.83 },
      }),
      getSolPrice: jest.fn().mockReturnValue(200),
    } as unknown as jest.Mocked<TokenAggregator>;

    app = express();
    app.use(express.json());
    app.use('/api/tokens', createTokenRoutes(mockAggregator));
    app.use('/api/health', createHealthRoutes(mockAggregator));
    app.use(notFoundHandler);
    app.use(errorHandler);
  });

  describe('GET /api/tokens', () => {
    it('should return paginated token list', async () => {
      const response = await request(app)
        .get('/api/tokens')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('pagination');
      expect(Array.isArray(response.body.data.data)).toBe(true);
    });

    it('should accept filter parameters', async () => {
      await request(app)
        .get('/api/tokens')
        .query({
          min_volume: 1000,
          max_volume: 100000,
          min_market_cap: 10000,
          protocol: 'raydium',
        })
        .expect(200);

      expect(mockAggregator.getTokens).toHaveBeenCalled();
    });

    it('should accept sort parameters', async () => {
      await request(app)
        .get('/api/tokens')
        .query({
          sort_by: 'volume',
          sort_dir: 'desc',
        })
        .expect(200);

      expect(mockAggregator.getTokens).toHaveBeenCalled();
    });

    it('should accept pagination parameters', async () => {
      await request(app)
        .get('/api/tokens')
        .query({
          limit: 20,
          cursor: 'eyJpbmRleCI6MjB9', // base64 encoded cursor
        })
        .expect(200);

      expect(mockAggregator.getTokens).toHaveBeenCalled();
    });
  });

  describe('GET /api/tokens/search', () => {
    it('should search tokens by query', async () => {
      const response = await request(app)
        .get('/api/tokens/search')
        .query({ q: 'Token' })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('tokens');
      expect(mockAggregator.searchTokens).toHaveBeenCalledWith('Token', expect.any(Number));
    });

    it('should return error for empty query', async () => {
      const response = await request(app)
        .get('/api/tokens/search')
        .query({ q: '' })
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toHaveProperty('code', 'INVALID_QUERY');
    });
  });

  describe('GET /api/tokens/:address', () => {
    it('should return token by address', async () => {
      const response = await request(app)
        .get(`/api/tokens/${ADDR_1}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('token_address', ADDR_1);
    });

    it('should return 404 for non-existent token', async () => {
      const response = await request(app)
        .get('/api/tokens/non-existent-token-address-12345678')
        .expect(404);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toHaveProperty('code', 'TOKEN_NOT_FOUND');
    });

    it('should return 400 for invalid address format', async () => {
      const response = await request(app)
        .get('/api/tokens/short')
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toHaveProperty('code', 'INVALID_ADDRESS');
    });
  });

  describe('POST /api/tokens/batch', () => {
    it('should return multiple tokens by addresses', async () => {
      const response = await request(app)
        .post('/api/tokens/batch')
        .send({ addresses: [ADDR_1, ADDR_2] })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('tokens');
      expect(response.body.data).toHaveProperty('not_found');
    });

    it('should return error for empty addresses array', async () => {
      const response = await request(app)
        .post('/api/tokens/batch')
        .send({ addresses: [] })
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toHaveProperty('code', 'INVALID_REQUEST');
    });

    it('should return error for too many addresses', async () => {
      const addresses = Array(101).fill('token-address');
      
      const response = await request(app)
        .post('/api/tokens/batch')
        .send({ addresses })
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toHaveProperty('code', 'TOO_MANY_ADDRESSES');
    });
  });

  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('status');
      expect(response.body.data).toHaveProperty('uptime');
      expect(response.body.data).toHaveProperty('services');
      expect(response.body.data).toHaveProperty('stats');
    });
  });

  describe('GET /api/health/live', () => {
    it('should return liveness status', async () => {
      const response = await request(app)
        .get('/api/health/live')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
    });
  });

  describe('GET /api/health/stats', () => {
    it('should return detailed statistics', async () => {
      const response = await request(app)
        .get('/api/health/stats')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('uptime_ms');
      expect(response.body.data).toHaveProperty('aggregator');
      expect(response.body.data).toHaveProperty('cache');
    });
  });

  describe('404 Handler', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app)
        .get('/api/unknown')
        .expect(404);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toHaveProperty('code', 'NOT_FOUND');
    });
  });
});
