// Token data - the main thing we work with
export interface Token {
  token_address: string;
  token_name: string;
  token_ticker: string;
  price_sol: number;
  price_usd: number;
  market_cap_sol: number;
  market_cap_usd: number;
  volume_sol: number;
  volume_usd: number;
  liquidity_sol: number;
  liquidity_usd: number;
  transaction_count: number;
  price_1hr_change: number;
  price_24hr_change: number;
  price_7d_change: number;
  volume_1hr: number;
  volume_24hr: number;
  volume_7d: number;
  protocol: string;
  dex_id: string;
  chain_id: string;
  pair_address: string;
  created_at: string;
  last_updated: string;
  sources: string[];
  image_url?: string;
  website?: string;
  socials?: TokenSocials;
}

export interface TokenSocials {
  twitter?: string;
  telegram?: string;
  discord?: string;
}

// DexScreener API types
export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv: number;
  pairCreatedAt: number;
  info?: {
    imageUrl?: string;
    websites?: { label: string; url: string }[];
    socials?: { type: string; url: string }[];
  };
}

export interface DexScreenerResponse {
  schemaVersion: string;
  pairs: DexScreenerPair[] | null;
}

// Jupiter API types
export interface JupiterToken {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  tags?: string[];
  daily_volume?: number;
  freeze_authority?: string;
  mint_authority?: string;
}

export interface JupiterPriceData {
  id: string;
  mintSymbol: string;
  vsToken: string;
  vsTokenSymbol: string;
  price: number;
}

// GeckoTerminal API types
export interface GeckoTerminalPool {
  id: string;
  type: string;
  attributes: {
    base_token_price_usd: string;
    base_token_price_native_currency: string;
    quote_token_price_usd: string;
    quote_token_price_native_currency: string;
    address: string;
    name: string;
    pool_created_at: string;
    fdv_usd: string;
    market_cap_usd: string | null;
    price_change_percentage: {
      m5: string;
      h1: string;
      h6: string;
      h24: string;
    };
    transactions: {
      m5: { buys: number; sells: number; buyers: number; sellers: number };
      m15: { buys: number; sells: number; buyers: number; sellers: number };
      m30: { buys: number; sells: number; buyers: number; sellers: number };
      h1: { buys: number; sells: number; buyers: number; sellers: number };
      h24: { buys: number; sells: number; buyers: number; sellers: number };
    };
    volume_usd: {
      m5: string;
      h1: string;
      h6: string;
      h24: string;
    };
    reserve_in_usd: string;
  };
  relationships: {
    base_token: { data: { id: string; type: string } };
    quote_token: { data: { id: string; type: string } };
    dex: { data: { id: string; type: string } };
  };
}

export interface GeckoTerminalResponse {
  data: GeckoTerminalPool[];
  included?: Array<{
    id: string;
    type: string;
    attributes: {
      address: string;
      name: string;
      symbol: string;
      image_url?: string;
      coingecko_coin_id?: string;
    };
  }>;
}

// Query params
export interface TokenFilter {
  timePeriod?: '1h' | '24h' | '7d';
  minVolume?: number;
  maxVolume?: number;
  minMarketCap?: number;
  maxMarketCap?: number;
  minLiquidity?: number;
  protocol?: string;
  chain?: string;
  search?: string;
}

export interface TokenSort {
  field: 'volume' | 'price_change' | 'market_cap' | 'liquidity' | 'transaction_count' | 'created_at';
  direction: 'asc' | 'desc';
  timePeriod?: '1h' | '24h' | '7d';
}

export interface PaginationOptions {
  limit: number;
  cursor?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    limit: number;
    next_cursor: string | null;
    prev_cursor: string | null;
    total_count: number;
    has_more: boolean;
  };
  meta: {
    timestamp: string;
    cache_hit: boolean;
    sources: string[];
  };
}

// WebSocket stuff
export enum WebSocketEventType {
  PRICE_UPDATE = 'price_update',
  VOLUME_SPIKE = 'volume_spike',
  NEW_TOKEN = 'new_token',
  TOKEN_REMOVED = 'token_removed',
  BATCH_UPDATE = 'batch_update',
  ERROR = 'error',
  CONNECTED = 'connected',
  SUBSCRIBED = 'subscribed',
  UNSUBSCRIBED = 'unsubscribed',
}

export interface WebSocketMessage<T = unknown> {
  event: WebSocketEventType;
  data: T;
  timestamp: string;
}

export interface PriceUpdateData {
  token_address: string;
  old_price: number;
  new_price: number;
  price_change_percent: number;
  volume_24hr: number;
}

export interface VolumeSpikeData {
  token_address: string;
  token_ticker: string;
  volume_change_percent: number;
  current_volume: number;
  previous_volume: number;
  time_window: string;
}

// Cache
export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  sources: string[];
}

// API response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    timestamp: string;
    request_id: string;
    response_time_ms: number;
  };
}

// Rate limiter
export interface RateLimiterState {
  tokens: number;
  lastRefill: number;
  requestsInWindow: number[];
}

// Config for each DEX
export interface DexSourceConfig {
  name: string;
  baseUrl: string;
  rateLimit: number;
  timeout: number;
  retries: number;
  enabled: boolean;
}

// Health check
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  timestamp: string;
  services: {
    redis: ServiceStatus;
    dexscreener: ServiceStatus;
    jupiter: ServiceStatus;
    geckoterminal: ServiceStatus;
    websocket: ServiceStatus;
  };
  stats: {
    total_tokens: number;
    active_connections: number;
    cache_hit_rate: number;
    avg_response_time_ms: number;
  };
}

export interface ServiceStatus {
  status: 'up' | 'down' | 'degraded';
  latency_ms?: number;
  last_check: string;
  error?: string;
}
