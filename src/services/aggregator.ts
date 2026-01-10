import { DexScreenerClient } from './dexScreener';
import { JupiterClient } from './jupiter';
import { GeckoTerminalClient } from './geckoTerminal';
import { getCache, ICache } from './cache';
import { logger } from '../utils/index';
import config from '../config/index';
import type {
  Token,
  TokenFilter,
  TokenSort,
  PaginationOptions,
  PaginatedResponse,
  PriceUpdateData,
  VolumeSpikeData,
} from '../types/index';

/**
 * TokenAggregator - pulls data from multiple DEX APIs and merges them together
 * 
 * Basically the heart of this whole thing. Fetches from DexScreener, Jupiter, 
 * and GeckoTerminal, then smashes all the token data together into one list.
 */
export class TokenAggregator {
  private dexScreener: DexScreenerClient;
  private jupiter: JupiterClient;
  private geckoTerminal: GeckoTerminalClient;
  private cache: ICache;
  private tokensMap: Map<string, Token> = new Map();
  private previousPrices: Map<string, number> = new Map();
  private previousVolumes: Map<string, number> = new Map();
  private lastFullRefresh: Date | null = null;
  private solPrice: number = 200; // fallback price, updated periodically

  // callbacks for ws events
  private onPriceUpdate?: (data: PriceUpdateData) => void;
  private onVolumeSpike?: (data: VolumeSpikeData) => void;
  private onNewToken?: (token: Token) => void;

  constructor() {
    this.dexScreener = new DexScreenerClient();
    this.jupiter = new JupiterClient();
    this.geckoTerminal = new GeckoTerminalClient();
    this.cache = getCache();
  }

  // set up event handlers so we can notify websocket clients
  setEventHandlers(handlers: {
    onPriceUpdate?: (data: PriceUpdateData) => void;
    onVolumeSpike?: (data: VolumeSpikeData) => void;
    onNewToken?: (token: Token) => void;
  }): void {
    this.onPriceUpdate = handlers.onPriceUpdate;
    this.onVolumeSpike = handlers.onVolumeSpike;
    this.onNewToken = handlers.onNewToken;
  }

  // called on startup to load initial data
  async initialize(): Promise<void> {
    logger.info('Initializing Token Aggregator...');

    try {
      await this.updateSolPrice();
      await this.refreshAllData();
      logger.info(`Token Aggregator initialized with ${this.tokensMap.size} tokens`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to initialize Token Aggregator:', msg);
      throw error;
    }
  }

  // fetch current SOL price from jupiter
  // TODO: maybe add a fallback to coingecko or something
  async updateSolPrice(): Promise<void> {
    try {
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      const prices = await this.jupiter.getTokenPrices([SOL_MINT]);
      const solPrice = prices.get(SOL_MINT);

      if (solPrice && solPrice > 0) {
        this.solPrice = solPrice;
        logger.debug(`Updated SOL price: $${this.solPrice}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to update SOL price, using default:', msg);
      // just keep using the old price, not a big deal
    }
  }

  // hit all 3 APIs and merge the results
  async refreshAllData(): Promise<void> {
    const startTime = Date.now();
    logger.info('Starting full data refresh...');

    // run all fetches in parallel - if one fails, others still work
    const results = await Promise.allSettled([
      this.fetchFromDexScreener(),
      this.fetchFromGeckoTerminal(),
      this.fetchFromJupiter(),
    ]);

    let successCount = 0;
    const errors: string[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        successCount++;
      } else {
        errors.push(result.reason?.message || 'Unknown error');
      }
    }

    this.lastFullRefresh = new Date();
    await this.cacheTokens();

    const elapsed = Date.now() - startTime;
    logger.info(
      `Full refresh completed in ${elapsed}ms. ` +
      `${successCount}/3 sources succeeded. ` +
      `Total tokens: ${this.tokensMap.size}`
    );

    if (errors.length > 0) {
      logger.warn('Refresh errors:', errors);
    }
  }

  private async fetchFromDexScreener(): Promise<void> {
    try {
      const pairs = await this.dexScreener.getPairsByChain('solana', 100);

      for (const pair of pairs) {
        const token = this.dexScreener.transformToToken(pair, this.solPrice);
        this.mergeToken(token);
      }

      logger.debug(`Fetched ${pairs.length} pairs from DexScreener`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to fetch from DexScreener:', msg);
      throw error;
    }
  }

  private async fetchFromGeckoTerminal(): Promise<void> {
    try {
      // get both trending and new pools
      const [trending, newPools] = await Promise.all([
        this.geckoTerminal.getTrendingPools('solana'),
        this.geckoTerminal.getNewPools('solana'),
      ]);

      const allPools = [...trending, ...newPools];

      for (const pool of allPools) {
        const token = this.geckoTerminal.transformToToken(pool, this.solPrice);
        this.mergeToken(token);
      }

      logger.debug(`Fetched ${allPools.length} pools from GeckoTerminal`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to fetch from GeckoTerminal:', msg);
      throw error;
    }
  }

  private async fetchFromJupiter(): Promise<void> {
    try {
      const tokens = await this.jupiter.getTrendingTokens(50);

      // jup price api needs auth now so we skip it :/
      const addresses = tokens.map(t => t.address);
      const prices = await this.jupiter.getTokenPrices(addresses);

      for (const token of tokens) {
        const price = prices.get(token.address) || 0;
        const transformedToken = this.jupiter.transformToToken(token, price, this.solPrice);
        this.mergeToken(transformedToken);
      }

      logger.debug(`Fetched ${tokens.length} tokens from Jupiter`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to fetch from Jupiter:', msg);
      throw error;
    }
  }

  /**
   * merge token data from different sources
   * 
   * the tricky part here is that the same token can come from multiple APIs
   * with slightly different data. we try to keep the best values from each.
   */
  private mergeToken(newToken: Token): void {
    const existingToken = this.tokensMap.get(newToken.token_address);

    if (!existingToken) {
      // brand new token!
      this.tokensMap.set(newToken.token_address, newToken);

      if (this.onNewToken) {
        this.onNewToken(newToken);
      }
      return;
    }

    // save old values for change detection
    const prevPrice = this.previousPrices.get(newToken.token_address) || existingToken.price_usd;
    const prevVolume = this.previousVolumes.get(newToken.token_address) || existingToken.volume_24hr;

    // merge fields - prefer non-zero values
    const mergedToken: Token = {
      ...existingToken,
      price_sol: newToken.price_sol || existingToken.price_sol,
      price_usd: newToken.price_usd || existingToken.price_usd,
      market_cap_sol: newToken.market_cap_sol || existingToken.market_cap_sol,
      market_cap_usd: newToken.market_cap_usd || existingToken.market_cap_usd,
      volume_sol: newToken.volume_sol || existingToken.volume_sol,
      volume_usd: newToken.volume_usd || existingToken.volume_usd,
      liquidity_sol: newToken.liquidity_sol || existingToken.liquidity_sol,
      liquidity_usd: newToken.liquidity_usd || existingToken.liquidity_usd,
      transaction_count: Math.max(newToken.transaction_count, existingToken.transaction_count),
      price_1hr_change: newToken.price_1hr_change || existingToken.price_1hr_change,
      price_24hr_change: newToken.price_24hr_change || existingToken.price_24hr_change,
      volume_1hr: newToken.volume_1hr || existingToken.volume_1hr,
      volume_24hr: newToken.volume_24hr || existingToken.volume_24hr,
      last_updated: new Date().toISOString(),
      sources: [...new Set([...existingToken.sources, ...newToken.sources])],
      image_url: newToken.image_url || existingToken.image_url,
      website: newToken.website || existingToken.website,
      socials: { ...existingToken.socials, ...newToken.socials },
    };

    this.tokensMap.set(newToken.token_address, mergedToken);

    // check for significant price change (>1%) and notify
    if (prevPrice > 0 && mergedToken.price_usd > 0) {
      const priceChangePercent = ((mergedToken.price_usd - prevPrice) / prevPrice) * 100;

      if (Math.abs(priceChangePercent) >= 1 && this.onPriceUpdate) {
        this.onPriceUpdate({
          token_address: mergedToken.token_address,
          old_price: prevPrice,
          new_price: mergedToken.price_usd,
          price_change_percent: priceChangePercent,
          volume_24hr: mergedToken.volume_24hr,
        });
      }
    }

    // check for volume spike (>50% increase)
    if (prevVolume > 0 && mergedToken.volume_24hr > 0) {
      const volumeChangePercent = ((mergedToken.volume_24hr - prevVolume) / prevVolume) * 100;

      if (volumeChangePercent >= 50 && this.onVolumeSpike) {
        this.onVolumeSpike({
          token_address: mergedToken.token_address,
          token_ticker: mergedToken.token_ticker,
          volume_change_percent: volumeChangePercent,
          current_volume: mergedToken.volume_24hr,
          previous_volume: prevVolume,
          time_window: '5m',
        });
      }
    }

    // update previous values for next comparison
    this.previousPrices.set(mergedToken.token_address, mergedToken.price_usd);
    this.previousVolumes.set(mergedToken.token_address, mergedToken.volume_24hr);
  }

  // save tokens to cache so we don't have to hit APIs every request
  private async cacheTokens(): Promise<void> {
    try {
      const tokensArray = Array.from(this.tokensMap.values());
      await this.cache.set('tokens:all', tokensArray, config.cacheTtl);

      // also cache individual tokens for quick lookups
      for (const token of tokensArray) {
        await this.cache.set(`token:${token.token_address}`, token, config.cacheTtl);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to cache tokens: ${msg}`);
    }
  }

  // main method for getting tokens with filters/sorting/pagination
  async getTokens(
    filter?: TokenFilter,
    sort?: TokenSort,
    pagination?: PaginationOptions
  ): Promise<PaginatedResponse<Token>> {
    let cacheHit = false;

    // try cache first
    let tokens: Token[];
    const cachedTokens = await this.cache.get<Token[]>('tokens:all');

    if (cachedTokens && cachedTokens.length > 0) {
      tokens = cachedTokens;
      cacheHit = true;
    } else {
      tokens = Array.from(this.tokensMap.values());
    }

    if (filter) {
      tokens = this.applyFilters(tokens, filter);
    }

    if (sort) {
      tokens = this.applySorting(tokens, sort);
    }

    const limit = pagination?.limit || config.defaultPageSize;
    const { paginatedTokens, nextCursor, prevCursor, hasMore } = this.applyPagination(
      tokens,
      limit,
      pagination?.cursor
    );

    return {
      data: paginatedTokens,
      pagination: {
        limit,
        next_cursor: nextCursor,
        prev_cursor: prevCursor,
        total_count: tokens.length,
        has_more: hasMore,
      },
      meta: {
        timestamp: new Date().toISOString(),
        cache_hit: cacheHit,
        sources: this.getActiveSources(),
      },
    };
  }

  // get single token by address
  async getTokenByAddress(address: string): Promise<Token | null> {
    // check cache
    const cachedToken = await this.cache.get<Token>(`token:${address}`);
    if (cachedToken) {
      return cachedToken;
    }

    // check memory
    const token = this.tokensMap.get(address);
    if (token) {
      return token;
    }

    // try fetching from dexscreener as last resort
    try {
      const pairs = await this.dexScreener.getTokenByAddress(address);
      if (pairs.length > 0) {
        const token = this.dexScreener.transformToToken(pairs[0], this.solPrice);
        this.mergeToken(token);
        await this.cache.set(`token:${address}`, token, config.cacheTtl);
        return token;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to fetch token ${address}: ${msg}`);
    }

    return null;
  }

  // search by name or ticker
  async searchTokens(query: string, limit: number = 20): Promise<Token[]> {
    const lowerQuery = query.toLowerCase();

    // search in memory first
    const memoryResults = Array.from(this.tokensMap.values()).filter(
      token =>
        token.token_name.toLowerCase().includes(lowerQuery) ||
        token.token_ticker.toLowerCase().includes(lowerQuery)
    );

    if (memoryResults.length >= limit) {
      return memoryResults.slice(0, limit);
    }

    // if we don't have enough, hit the APIs
    try {
      const [dexPairs, geckoData] = await Promise.allSettled([
        this.dexScreener.searchTokens(query),
        this.geckoTerminal.searchPools(query),
      ]);

      if (dexPairs.status === 'fulfilled') {
        for (const pair of dexPairs.value) {
          if (pair.chainId === 'solana') {
            const token = this.dexScreener.transformToToken(pair, this.solPrice);
            this.mergeToken(token);
          }
        }
      }

      if (geckoData.status === 'fulfilled') {
        for (const pool of geckoData.value) {
          const token = this.geckoTerminal.transformToToken(pool, this.solPrice);
          this.mergeToken(token);
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`Search API error: ${msg}`);
    }

    // search again with updated data
    return Array.from(this.tokensMap.values())
      .filter(
        token =>
          token.token_name.toLowerCase().includes(lowerQuery) ||
          token.token_ticker.toLowerCase().includes(lowerQuery)
      )
      .slice(0, limit);
  }

  // filter tokens based on criteria
  private applyFilters(tokens: Token[], filter: TokenFilter): Token[] {
    return tokens.filter(token => {
      // pick the right metrics based on time period
      const timePeriod = filter.timePeriod || '24h';
      let volume: number;

      switch (timePeriod) {
        case '1h':
          volume = token.volume_1hr || token.volume_usd;
          break;
        case '7d':
          volume = token.volume_7d || token.volume_usd;
          break;
        case '24h':
        default:
          volume = token.volume_24hr || token.volume_usd;
          break;
      }

      // apply filters
      if (filter.minVolume !== undefined && volume < filter.minVolume) {
        return false;
      }
      if (filter.maxVolume !== undefined && volume > filter.maxVolume) {
        return false;
      }
      if (filter.minMarketCap !== undefined && token.market_cap_usd < filter.minMarketCap) {
        return false;
      }
      if (filter.maxMarketCap !== undefined && token.market_cap_usd > filter.maxMarketCap) {
        return false;
      }
      if (filter.minLiquidity !== undefined && token.liquidity_usd < filter.minLiquidity) {
        return false;
      }
      if (filter.protocol && token.protocol.toLowerCase() !== filter.protocol.toLowerCase()) {
        return false;
      }
      if (filter.chain && token.chain_id.toLowerCase() !== filter.chain.toLowerCase()) {
        return false;
      }

      // search filter
      if (filter.search) {
        const searchLower = filter.search.toLowerCase();
        const name = (token.token_name || '').toLowerCase();
        const ticker = (token.token_ticker || '').toLowerCase();
        const address = (token.token_address || '').toLowerCase();
        if (
          !name.includes(searchLower) &&
          !ticker.includes(searchLower) &&
          !address.includes(searchLower)
        ) {
          return false;
        }
      }

      return true;
    });
  }

  // sort tokens
  private applySorting(tokens: Token[], sort: TokenSort): Token[] {
    const sorted = [...tokens];
    const multiplier = sort.direction === 'desc' ? -1 : 1;
    const timePeriod = sort.timePeriod || '24h';

    // helpers for time-period-aware values
    const getVolume = (token: Token): number => {
      switch (timePeriod) {
        case '1h': return token.volume_1hr || token.volume_usd;
        case '7d': return token.volume_7d || token.volume_usd;
        default: return token.volume_24hr || token.volume_usd;
      }
    };

    const getPriceChange = (token: Token): number => {
      switch (timePeriod) {
        case '1h': return token.price_1hr_change;
        case '7d': return token.price_7d_change;
        default: return token.price_24hr_change;
      }
    };

    sorted.sort((a, b) => {
      let valueA: number;
      let valueB: number;

      switch (sort.field) {
        case 'volume':
          valueA = getVolume(a);
          valueB = getVolume(b);
          break;
        case 'price_change':
          valueA = getPriceChange(a);
          valueB = getPriceChange(b);
          break;
        case 'market_cap':
          valueA = a.market_cap_usd;
          valueB = b.market_cap_usd;
          break;
        case 'liquidity':
          valueA = a.liquidity_usd;
          valueB = b.liquidity_usd;
          break;
        case 'transaction_count':
          valueA = a.transaction_count;
          valueB = b.transaction_count;
          break;
        case 'created_at':
          valueA = new Date(a.created_at).getTime();
          valueB = new Date(b.created_at).getTime();
          break;
        default:
          valueA = getVolume(a);
          valueB = getVolume(b);
      }

      return (valueA - valueB) * multiplier;
    });

    return sorted;
  }

  // cursor pagination - works better than offset for live data
  private applyPagination(
    tokens: Token[],
    limit: number,
    cursor?: string
  ): {
    paginatedTokens: Token[];
    nextCursor: string | null;
    prevCursor: string | null;
    hasMore: boolean;
  } {
    let startIndex = 0;

    if (cursor) {
      try {
        startIndex = parseInt(Buffer.from(cursor, 'base64').toString('utf-8'), 10);
      } catch {
        startIndex = 0; // invalid cursor, just start from beginning
      }
    }

    const endIndex = Math.min(startIndex + limit, tokens.length);
    const paginatedTokens = tokens.slice(startIndex, endIndex);

    const hasMore = endIndex < tokens.length;
    const nextCursor = hasMore
      ? Buffer.from(endIndex.toString()).toString('base64')
      : null;
    const prevCursor = startIndex > 0
      ? Buffer.from(Math.max(0, startIndex - limit).toString()).toString('base64')
      : null;

    return { paginatedTokens, nextCursor, prevCursor, hasMore };
  }

  // get list of sources we've successfully fetched from
  private getActiveSources(): string[] {
    const sources = new Set<string>();
    for (const token of this.tokensMap.values()) {
      for (const source of token.sources) {
        sources.add(source);
      }
    }
    return Array.from(sources);
  }

  // stats for health endpoint
  getStats(): {
    totalTokens: number;
    lastRefresh: Date | null;
    sources: string[];
    cacheStats: { hits: number; misses: number; hitRate: number };
  } {
    const cacheStats = this.cache.getStats();
    return {
      totalTokens: this.tokensMap.size,
      lastRefresh: this.lastFullRefresh,
      sources: this.getActiveSources(),
      cacheStats: {
        hits: cacheStats.hits,
        misses: cacheStats.misses,
        hitRate: cacheStats.hitRate,
      },
    };
  }

  getSolPrice(): number {
    return this.solPrice;
  }

  // for ws batch updates
  getAllTokensArray(): Token[] {
    return Array.from(this.tokensMap.values());
  }
}

export default TokenAggregator;
