import Redis from 'ioredis';
import config from '../config/index';
import { logger } from '../utils/index';

// cache interface - both redis and memory versions implement this
export interface ICache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  keys(pattern: string): Promise<string[]>;
  flush(): Promise<void>;
  getStats(): { hits: number; misses: number; hitRate: number; size: number };
  isConnected(): boolean;
}

/**
 * In-memory cache - used when redis isn't available
 * 
 * Just a simple Map with TTL support. Good enough for single instance,
 * but won't work if you're running multiple servers.
 */
export class MemoryCache implements ICache {
  private data = new Map<string, { value: string; expiry: number }>();
  private hits = 0;
  private misses = 0;
  private cleanupTimer?: NodeJS.Timeout;

  private key(k: string) { return config.cachePrefix + k; }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.data.get(this.key(key));
    if (!entry || Date.now() > entry.expiry) {
      if (entry) this.data.delete(this.key(key)); // cleanup expired
      this.misses++;
      return null;
    }
    this.hits++;
    return JSON.parse(entry.value);
  }

  async set<T>(key: string, value: T, ttl = config.cacheTtl): Promise<void> {
    this.data.set(this.key(key), {
      value: JSON.stringify(value),
      expiry: Date.now() + ttl * 1000
    });
  }

  async delete(key: string) { this.data.delete(this.key(key)); }

  async exists(key: string): Promise<boolean> {
    const entry = this.data.get(this.key(key));
    if (!entry) return false;
    if (Date.now() > entry.expiry) {
      this.data.delete(this.key(key));
      return false;
    }
    return true;
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp(pattern.replace('*', '.*'));
    return [...this.data.keys()].filter(k => regex.test(k) && this.data.get(k)!.expiry > Date.now());
  }

  async flush() {
    this.data.clear();
    this.hits = this.misses = 0;
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total ? this.hits / total : 0,
      size: this.data.size
    };
  }

  isConnected() { return true; } // always "connected"

  // run cleanup every minute to remove old entries
  startCleanup(ms = 60000) {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [k, v] of this.data) {
        if (now > v.expiry) this.data.delete(k);
      }
    }, ms);

    // don't keep process alive just for cleanup
    this.cleanupTimer.unref?.();
  }

  stopCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }
}

/**
 * Redis cache - the real deal for production
 * 
 * Use this when you have multiple server instances that need
 * to share the same cache.
 */
export class RedisCache implements ICache {
  private client: Redis;
  private connected = false;
  private hits = 0;
  private misses = 0;

  constructor() {
    this.client = new Redis(config.redisUrl, {
      password: config.redisPassword || undefined,
      retryStrategy: (times) => times > 3 ? null : Math.min(times * 200, 2000),
      lazyConnect: true
    });

    this.client.on('connect', () => {
      this.connected = true;
      logger.info('Redis connected');
    });
    this.client.on('error', (e) => {
      this.connected = false;
      logger.error('Redis error:', e);
    });
    this.client.on('close', () => { this.connected = false; });
  }

  private key(k: string) { return config.cachePrefix + k; }

  async connect() { await this.client.connect(); }

  async get<T>(key: string): Promise<T | null> {
    try {
      const val = await this.client.get(this.key(key));
      if (!val) {
        this.misses++;
        return null;
      }
      this.hits++;
      return JSON.parse(val);
    } catch (e) {
      logger.error(`Cache get error [${key}]:`, e);
      this.misses++;
      return null;
    }
  }

  async set<T>(key: string, value: T, ttl = config.cacheTtl): Promise<void> {
    try {
      await this.client.setex(this.key(key), ttl, JSON.stringify(value));
    } catch (e) {
      logger.error(`Cache set error [${key}]:`, e);
    }
  }

  async delete(key: string) {
    try { await this.client.del(this.key(key)); }
    catch (e) { logger.error(`Cache delete error [${key}]:`, e); }
  }

  async exists(key: string): Promise<boolean> {
    try { return (await this.client.exists(this.key(key))) === 1; }
    catch { return false; }
  }

  async keys(pattern: string): Promise<string[]> {
    try { return await this.client.keys(config.cachePrefix + pattern); }
    catch { return []; }
  }

  async flush() {
    const keys = await this.keys('*');
    if (keys.length) await this.client.del(...keys);
    this.hits = this.misses = 0;
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total ? this.hits / total : 0,
      size: -1 // can't easily get redis size
    };
  }

  isConnected() { return this.connected; }
  async disconnect() { await this.client.quit(); }
}

// factory - picks the right cache based on config
export function createCache(): ICache {
  if (config.useMemoryCache) {
    logger.info('Using in-memory cache');
    const cache = new MemoryCache();
    cache.startCleanup();
    return cache;
  }
  logger.info('Using Redis cache');
  return new RedisCache();
}

// singleton so we only create one cache instance
let instance: ICache | null = null;
export function getCache(): ICache {
  if (!instance) instance = createCache();
  return instance;
}

export default getCache;
