import axios, { AxiosInstance, AxiosError } from 'axios';
import config from '../config/index';
import { RateLimiter, withRetry, logger } from '../utils/index';
import type { DexScreenerResponse, DexScreenerPair, Token } from '../types/index';

// DexScreener API client with rate limiting
export class DexScreenerClient {
  private client: AxiosInstance;
  private limiter: RateLimiter;
  private readonly SOURCE = 'dexscreener';

  constructor() {
    this.client = axios.create({
      baseURL: config.dexScreenerBaseUrl,
      timeout: 10000,
      headers: { 'Accept': 'application/json', 'User-Agent': 'MemeCoinAggregator/1.0' }
    });

    this.limiter = RateLimiter.create({
      maxRequests: config.dexScreenerRateLimit,
      windowMs: 60000,
      name: 'dexscreener'
    });
  }

  // Generic fetch with rate limiting & retries
  private async fetch<T>(url: string, params?: object): Promise<T> {
    await this.limiter.waitForToken();
    try {
      const res = await withRetry(
        () => this.client.get<T>(url, { params }),
        { maxRetries: 3, onRetry: () => this.limiter.reportFailure() }
      );
      this.limiter.reportSuccess();
      return res.data;
    } catch (e) {
      this.limiter.reportFailure();
      throw e;
    }
  }

  async searchTokens(query: string): Promise<DexScreenerPair[]> {
    const data = await this.fetch<DexScreenerResponse>('/latest/dex/search', { q: query });
    return data.pairs || [];
  }

  async getTokenByAddress(address: string): Promise<DexScreenerPair[]> {
    const data = await this.fetch<DexScreenerResponse>(`/latest/dex/tokens/${address}`);
    return data.pairs || [];
  }

  async getTrendingTokens(): Promise<DexScreenerPair[]> {
    const data = await this.fetch<DexScreenerResponse>('/latest/dex/search', { q: 'solana' });
    return (data.pairs || [])
      .filter(p => p.chainId === 'solana')
      .sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0));
  }

  // Fetch tokens by searching common meme keywords
  async getPairsByChain(chain = 'solana', limit = 50): Promise<DexScreenerPair[]> {
    const queries = ['pump', 'meme', 'pepe', 'doge', 'cat', 'ai'];
    const results: DexScreenerPair[] = [];
    const seen = new Set<string>();

    for (const q of queries) {
      try {
        const pairs = await this.searchTokens(q);
        for (const p of pairs) {
          if (p.chainId === chain && !seen.has(p.baseToken.address)) {
            seen.add(p.baseToken.address);
            results.push(p);
          }
        }
        if (results.length >= limit) break;
        await new Promise(r => setTimeout(r, 200)); // don't hammer the API
      } catch (e) {
        logger.warn(`Search "${q}" failed: ${e}`);
      }
    }
    return results.slice(0, limit);
  }

  // Convert DexScreener pair to our unified Token format
  transformToToken(pair: DexScreenerPair, solPrice = 200): Token {
    const priceUsd = parseFloat(pair.priceUsd || '0');
    const vol24h = pair.volume?.h24 || 0;
    const liqUsd = pair.liquidity?.usd || 0;
    const mcap = pair.fdv || 0;
    const txns = pair.txns?.h24;

    return {
      token_address: pair.baseToken.address,
      token_name: pair.baseToken.name,
      token_ticker: pair.baseToken.symbol,
      price_sol: priceUsd / solPrice,
      price_usd: priceUsd,
      market_cap_sol: mcap / solPrice,
      market_cap_usd: mcap,
      volume_sol: vol24h / solPrice,
      volume_usd: vol24h,
      liquidity_sol: liqUsd / solPrice,
      liquidity_usd: liqUsd,
      transaction_count: (txns?.buys || 0) + (txns?.sells || 0),
      price_1hr_change: pair.priceChange?.h1 || 0,
      price_24hr_change: pair.priceChange?.h24 || 0,
      price_7d_change: 0,
      volume_1hr: pair.volume?.h1 || 0,
      volume_24hr: vol24h,
      volume_7d: 0,
      protocol: pair.dexId,
      dex_id: pair.dexId,
      chain_id: pair.chainId,
      pair_address: pair.pairAddress,
      created_at: pair.pairCreatedAt ? new Date(pair.pairCreatedAt).toISOString() : new Date().toISOString(),
      last_updated: new Date().toISOString(),
      sources: [this.SOURCE],
      image_url: pair.info?.imageUrl,
      website: pair.info?.websites?.[0]?.url,
      socials: this.extractSocials(pair)
    };
  }

  private extractSocials(pair: DexScreenerPair) {
    const s: Token['socials'] = {};
    for (const x of pair.info?.socials || []) {
      if (x.type === 'twitter') s.twitter = x.url;
      if (x.type === 'telegram') s.telegram = x.url;
      if (x.type === 'discord') s.discord = x.url;
    }
    return s;
  }

  getRateLimitStatus() {
    return { available: this.limiter.getAvailableTokens(), name: this.SOURCE };
  }
}

export default DexScreenerClient;
