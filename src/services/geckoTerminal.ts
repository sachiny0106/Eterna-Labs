import axios, { AxiosInstance } from 'axios';
import config from '../config/index';
import { RateLimiter, withRetry, logger } from '../utils/index';
import type { GeckoTerminalPool, GeckoTerminalResponse, Token } from '../types/index';

// GeckoTerminal API client - great for trending pools
export class GeckoTerminalClient {
  private client: AxiosInstance;
  private limiter: RateLimiter;
  private readonly SOURCE = 'geckoterminal';

  constructor() {
    this.client = axios.create({
      baseURL: config.geckoTerminalBaseUrl,
      timeout: 15000,
      headers: { 'Accept': 'application/json', 'User-Agent': 'MemeCoinAggregator/1.0' }
    });

    this.limiter = RateLimiter.create({
      maxRequests: config.geckoTerminalRateLimit,
      windowMs: 60000,
      name: 'geckoterminal'
    });
  }

  // Generic fetch with rate limiting
  private async fetch<T>(url: string, params?: object): Promise<T> {
    await this.limiter.waitForToken();
    try {
      const res = await withRetry(() => this.client.get<T>(url, { params }), { maxRetries: 3 });
      this.limiter.reportSuccess();
      return res.data;
    } catch (e) {
      this.limiter.reportFailure();
      throw e;
    }
  }

  async getTrendingPools(network = 'solana', page = 1): Promise<GeckoTerminalPool[]> {
    const data = await this.fetch<GeckoTerminalResponse>(`/networks/${network}/trending_pools`, { page });
    return data.data || [];
  }

  async getNewPools(network = 'solana', page = 1): Promise<GeckoTerminalPool[]> {
    const data = await this.fetch<GeckoTerminalResponse>(`/networks/${network}/new_pools`, { page });
    return data.data || [];
  }

  async getTopPools(network = 'solana', page = 1): Promise<GeckoTerminalPool[]> {
    const data = await this.fetch<GeckoTerminalResponse>(`/networks/${network}/pools`, { 
      page, 
      sort: 'h24_volume_usd_desc' 
    });
    return data.data || [];
  }

  async searchPools(query: string, network = 'solana'): Promise<GeckoTerminalPool[]> {
    const data = await this.fetch<GeckoTerminalResponse>('/search/pools', { query, network });
    return data.data || [];
  }

  async getPoolByAddress(network: string, address: string): Promise<GeckoTerminalPool | null> {
    try {
      const data = await this.fetch<{ data: GeckoTerminalPool }>(`/networks/${network}/pools/${address}`);
      return data.data || null;
    } catch {
      return null;
    }
  }

  // Convert GeckoTerminal pool to our unified format
  transformToToken(pool: GeckoTerminalPool, solPrice = 200): Token {
    const a = pool.attributes;
    const priceUsd = parseFloat(a.base_token_price_usd) || 0;
    const mcap = a.market_cap_usd ? parseFloat(a.market_cap_usd) : parseFloat(a.fdv_usd) || 0;
    const liq = parseFloat(a.reserve_in_usd) || 0;
    const vol24h = parseFloat(a.volume_usd?.h24) || 0;
    
    // Extract token address from relationship ID (format: "network_address")
    const baseId = pool.relationships.base_token.data.id;
    const tokenAddr = baseId.includes('_') ? baseId.split('_')[1] : baseId;
    const [tokenName] = a.name.split('/');
    const txns = a.transactions?.h24;

    return {
      token_address: tokenAddr,
      token_name: tokenName.trim(),
      token_ticker: tokenName.trim(),
      price_sol: priceUsd / solPrice,
      price_usd: priceUsd,
      market_cap_sol: mcap / solPrice,
      market_cap_usd: mcap,
      volume_sol: vol24h / solPrice,
      volume_usd: vol24h,
      liquidity_sol: liq / solPrice,
      liquidity_usd: liq,
      transaction_count: (txns?.buys || 0) + (txns?.sells || 0),
      price_1hr_change: parseFloat(a.price_change_percentage?.h1) || 0,
      price_24hr_change: parseFloat(a.price_change_percentage?.h24) || 0,
      price_7d_change: 0,
      volume_1hr: parseFloat(a.volume_usd?.h1) || 0,
      volume_24hr: vol24h,
      volume_7d: 0,
      protocol: pool.relationships.dex?.data?.id || 'unknown',
      dex_id: pool.relationships.dex?.data?.id || 'unknown',
      chain_id: 'solana',
      pair_address: a.address,
      created_at: a.pool_created_at || new Date().toISOString(),
      last_updated: new Date().toISOString(),
      sources: [this.SOURCE]
    };
  }

  getRateLimitStatus() {
    return { available: this.limiter.getAvailableTokens(), name: this.SOURCE };
  }
}

export default GeckoTerminalClient;
