import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// Config schema - validates env vars
const configSchema = z.object({
  // Server
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.number().int().positive().default(3000),

  // Redis
  redisUrl: z.string().url().optional().default('redis://localhost:6379'),
  redisPassword: z.string().optional(),
  useMemoryCache: z.boolean().default(true),

  // Cache
  cacheTtl: z.number().int().positive().default(30),
  cachePrefix: z.string().default('meme-coin:'),

  // API Rate Limits (per minute)
  dexScreenerRateLimit: z.number().int().positive().default(300),
  jupiterRateLimit: z.number().int().positive().default(100),
  geckoTerminalRateLimit: z.number().int().positive().default(30),

  // WebSocket
  wsPingInterval: z.number().int().positive().default(25000),
  wsPingTimeout: z.number().int().positive().default(5000),

  // Update Intervals (seconds)
  priceUpdateInterval: z.number().int().positive().default(10),
  fullRefreshInterval: z.number().int().positive().default(60),

  // Pagination
  defaultPageSize: z.number().int().positive().default(30),
  maxPageSize: z.number().int().positive().default(100),

  // Logging
  logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  // API Endpoints
  dexScreenerBaseUrl: z.string().url().default('https://api.dexscreener.com'),
  jupiterBaseUrl: z.string().url().default('https://lite-api.jup.ag'),
  geckoTerminalBaseUrl: z.string().url().default('https://api.geckoterminal.com/api/v2'),
});

type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const rawConfig = {
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : undefined,
    redisUrl: process.env.REDIS_URL,
    redisPassword: process.env.REDIS_PASSWORD,
    useMemoryCache: process.env.USE_MEMORY_CACHE === 'true',
    cacheTtl: process.env.CACHE_TTL ? parseInt(process.env.CACHE_TTL, 10) : undefined,
    cachePrefix: process.env.CACHE_PREFIX,
    dexScreenerRateLimit: process.env.DEXSCREENER_RATE_LIMIT
      ? parseInt(process.env.DEXSCREENER_RATE_LIMIT, 10)
      : undefined,
    jupiterRateLimit: process.env.JUPITER_RATE_LIMIT
      ? parseInt(process.env.JUPITER_RATE_LIMIT, 10)
      : undefined,
    geckoTerminalRateLimit: process.env.GECKOTERMINAL_RATE_LIMIT
      ? parseInt(process.env.GECKOTERMINAL_RATE_LIMIT, 10)
      : undefined,
    wsPingInterval: process.env.WS_PING_INTERVAL
      ? parseInt(process.env.WS_PING_INTERVAL, 10)
      : undefined,
    wsPingTimeout: process.env.WS_PING_TIMEOUT
      ? parseInt(process.env.WS_PING_TIMEOUT, 10)
      : undefined,
    priceUpdateInterval: process.env.PRICE_UPDATE_INTERVAL
      ? parseInt(process.env.PRICE_UPDATE_INTERVAL, 10)
      : undefined,
    fullRefreshInterval: process.env.FULL_REFRESH_INTERVAL
      ? parseInt(process.env.FULL_REFRESH_INTERVAL, 10)
      : undefined,
    defaultPageSize: process.env.DEFAULT_PAGE_SIZE
      ? parseInt(process.env.DEFAULT_PAGE_SIZE, 10)
      : undefined,
    maxPageSize: process.env.MAX_PAGE_SIZE
      ? parseInt(process.env.MAX_PAGE_SIZE, 10)
      : undefined,
    logLevel: process.env.LOG_LEVEL,
    dexScreenerBaseUrl: process.env.DEXSCREENER_BASE_URL,
    jupiterBaseUrl: process.env.JUPITER_BASE_URL,
    geckoTerminalBaseUrl: process.env.GECKOTERMINAL_BASE_URL,
  };

  // Remove undefined values
  const cleanConfig = Object.fromEntries(
    Object.entries(rawConfig).filter(([, v]) => v !== undefined)
  );

  const result = configSchema.safeParse(cleanConfig);

  if (!result.success) {
    throw new Error(`Invalid configuration: ${JSON.stringify(result.error.format())}`);
  }

  return result.data;
}

export const config = loadConfig();

export default config;
