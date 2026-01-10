import axios, { AxiosInstance } from 'axios';
import { DexScreenerClient } from '../../src/services/dexScreener';
import { JupiterClient } from '../../src/services/jupiter';
import { GeckoTerminalClient } from '../../src/services/geckoTerminal';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('DEX API Clients', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup axios mock
    mockedAxios.create.mockReturnValue({
      get: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    } as unknown as AxiosInstance);
  });

  describe('DexScreenerClient', () => {
    let client: DexScreenerClient;

    beforeEach(() => {
      client = new DexScreenerClient();
    });

    it('should transform pair data to token format', () => {
      const mockPair = {
        chainId: 'solana',
        dexId: 'raydium',
        url: 'https://dexscreener.com/solana/test',
        pairAddress: 'test-pair-address',
        baseToken: {
          address: 'test-token-address',
          name: 'Test Token',
          symbol: 'TEST',
        },
        quoteToken: {
          address: 'sol-address',
          name: 'Solana',
          symbol: 'SOL',
        },
        priceNative: '0.001',
        priceUsd: '0.2',
        txns: {
          m5: { buys: 10, sells: 5 },
          h1: { buys: 50, sells: 25 },
          h6: { buys: 200, sells: 100 },
          h24: { buys: 500, sells: 250 },
        },
        volume: {
          m5: 1000,
          h1: 5000,
          h6: 20000,
          h24: 50000,
        },
        priceChange: {
          m5: 1.5,
          h1: 5.0,
          h6: 10.0,
          h24: 25.0,
        },
        liquidity: {
          usd: 100000,
          base: 500000,
          quote: 500,
        },
        fdv: 1000000,
        pairCreatedAt: Date.now() - 86400000,
      };

      const token = client.transformToToken(mockPair, 200);

      expect(token.token_address).toBe('test-token-address');
      expect(token.token_name).toBe('Test Token');
      expect(token.token_ticker).toBe('TEST');
      expect(token.price_usd).toBe(0.2);
      expect(token.volume_24hr).toBe(50000);
      expect(token.price_24hr_change).toBe(25.0);
      expect(token.liquidity_usd).toBe(100000);
      expect(token.transaction_count).toBe(750); // 500 + 250
      expect(token.chain_id).toBe('solana');
      expect(token.protocol).toBe('raydium');
      expect(token.sources).toContain('dexscreener');
    });

    it('should get rate limit status', () => {
      const status = client.getRateLimitStatus();
      
      expect(status).toHaveProperty('available');
      expect(status).toHaveProperty('name');
      expect(status.name).toBe('dexscreener');
    });
  });

  describe('JupiterClient', () => {
    let client: JupiterClient;

    beforeEach(() => {
      client = new JupiterClient();
    });

    it('should transform token data to unified format', () => {
      const mockToken = {
        address: 'test-address',
        name: 'Jupiter Token',
        symbol: 'JUP',
        decimals: 9,
        logoURI: 'https://example.com/logo.png',
        daily_volume: 1000000,
      };

      const token = client.transformToToken(mockToken, 1.5, 200);

      expect(token.token_address).toBe('test-address');
      expect(token.token_name).toBe('Jupiter Token');
      expect(token.token_ticker).toBe('JUP');
      expect(token.price_usd).toBe(1.5);
      expect(token.volume_24hr).toBe(1000000);
      expect(token.image_url).toBe('https://example.com/logo.png');
      expect(token.sources).toContain('jupiter');
    });

    it('should get rate limit status', () => {
      const status = client.getRateLimitStatus();
      
      expect(status).toHaveProperty('available');
      expect(status).toHaveProperty('name');
      expect(status.name).toBe('jupiter');
    });
  });

  describe('GeckoTerminalClient', () => {
    let client: GeckoTerminalClient;

    beforeEach(() => {
      client = new GeckoTerminalClient();
    });

    it('should transform pool data to token format', () => {
      const mockPool = {
        id: 'solana_test-pool',
        type: 'pool',
        attributes: {
          base_token_price_usd: '0.5',
          base_token_price_native_currency: '0.0025',
          quote_token_price_usd: '200',
          quote_token_price_native_currency: '1',
          address: 'pool-address',
          name: 'MEME/SOL',
          pool_created_at: '2024-01-01T00:00:00Z',
          fdv_usd: '5000000',
          market_cap_usd: '4000000',
          price_change_percentage: {
            m5: '1.5',
            h1: '5.0',
            h6: '10.0',
            h24: '25.0',
          },
          transactions: {
            m5: { buys: 10, sells: 5, buyers: 8, sellers: 4 },
            m15: { buys: 30, sells: 15, buyers: 20, sellers: 10 },
            m30: { buys: 50, sells: 25, buyers: 35, sellers: 20 },
            h1: { buys: 100, sells: 50, buyers: 70, sellers: 40 },
            h24: { buys: 1000, sells: 500, buyers: 500, sellers: 300 },
          },
          volume_usd: {
            m5: '5000',
            h1: '25000',
            h6: '100000',
            h24: '500000',
          },
          reserve_in_usd: '200000',
        },
        relationships: {
          base_token: { data: { id: 'solana_test-token', type: 'token' } },
          quote_token: { data: { id: 'solana_sol', type: 'token' } },
          dex: { data: { id: 'raydium', type: 'dex' } },
        },
      };

      const token = client.transformToToken(mockPool, 200);

      expect(token.token_address).toBe('test-token');
      expect(token.token_name).toBe('MEME');
      expect(token.price_usd).toBe(0.5);
      expect(token.volume_24hr).toBe(500000);
      expect(token.price_24hr_change).toBe(25.0);
      expect(token.liquidity_usd).toBe(200000);
      expect(token.transaction_count).toBe(1500); // 1000 + 500
      expect(token.protocol).toBe('raydium');
      expect(token.sources).toContain('geckoterminal');
    });

    it('should get rate limit status', () => {
      const status = client.getRateLimitStatus();
      
      expect(status).toHaveProperty('available');
      expect(status).toHaveProperty('name');
      expect(status.name).toBe('geckoterminal');
    });
  });
});
