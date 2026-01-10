import axios, { AxiosInstance } from 'axios';
import config from '../config/index';
import { RateLimiter, withRetry, logger } from '../utils/index';
import type { JupiterToken, Token } from '../types/index';

// Jupiter API client - mainly for token discovery
// Note: Price API v2 now requires auth, so we skip it
export class JupiterClient {
  private client: AxiosInstance;
  private limiter: RateLimiter;
  private readonly SOURCE = 'jupiter';

  constructor() {
    const headers = { 'Accept': 'application/json', 'User-Agent': 'MemeCoinAggregator/1.0' };
    this.client = axios.create({ baseURL: config.jupiterBaseUrl, timeout: 10000, headers });
    this.limiter = RateLimiter.create({ maxRequests: config.jupiterRateLimit, windowMs: 60000, name: 'jupiter' });
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

  async searchTokens(query: string): Promise<JupiterToken[]> {
    try {
      const data = await this.fetch<JupiterToken[]>('/tokens/v2/search', { query });
      return data || [];
    } catch (e) {
      logger.warn(`Jupiter search failed: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  }

  async getAllTokens(): Promise<JupiterToken[]> {
    try {
      const data = await this.fetch<JupiterToken[]>('/tokens/v2/mints/tradable');
      return data || [];
    } catch (e) {
      logger.warn(`Jupiter getAllTokens failed: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  }

  // Price API now requires auth - skip it, return empty map
  async getTokenPrices(_addresses: string[]): Promise<Map<string, number>> {
    return new Map();
  }

  // Discover tokens by searching common meme terms
  async getTrendingTokens(limit = 50): Promise<JupiterToken[]> {
    const queries = ['meme', 'pump', 'pepe', 'doge', 'cat', 'ai', 'sol'];
    const results: JupiterToken[] = [];
    const seen = new Set<string>();

    for (const q of queries) {
      try {
        const tokens = await this.searchTokens(q);
        for (const t of tokens) {
          if (!seen.has(t.address)) {
            seen.add(t.address);
            results.push(t);
          }
        }
        if (results.length >= limit) break;
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        logger.warn(`Jupiter search "${q}" failed: ${e}`);
      }
    }
    return results.sort((a, b) => (b.daily_volume || 0) - (a.daily_volume || 0)).slice(0, limit);
  }

  transformToToken(token: JupiterToken, priceUsd = 0, solPrice = 200): Token {
    const vol24h = token.daily_volume || 0;
    return {
      token_address: token.address,
      token_name: token.name,
      token_ticker: token.symbol,
      price_sol: priceUsd / solPrice,
      price_usd: priceUsd,
      market_cap_sol: 0,
      market_cap_usd: 0,
      volume_sol: vol24h / solPrice,
      volume_usd: vol24h,
      liquidity_sol: 0,
      liquidity_usd: 0,
      transaction_count: 0,
      price_1hr_change: 0,
      price_24hr_change: 0,
      price_7d_change: 0,
      volume_1hr: 0,
      volume_24hr: vol24h,
      volume_7d: 0,
      protocol: 'jupiter',
      dex_id: 'jupiter',
      chain_id: 'solana',
      pair_address: '',
      created_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      sources: [this.SOURCE],
      image_url: token.logoURI
    };
  }

  getRateLimitStatus() {
    return { available: this.limiter.getAvailableTokens(), name: this.SOURCE };
  }
}

export default JupiterClient;
