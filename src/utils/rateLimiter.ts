import logger from './logger';

/**
 * Simple rate limiter using token bucket algorithm
 * 
 * basically we have a bucket of tokens that refills over time.
 * each request takes a token. if bucket is empty, we wait.
 * also does exponential backoff when we hit errors.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private failures = 0;

  constructor(
    private maxTokens: number,
    private refillRate: number, // tokens per second
    private name: string
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  // easier way to create one
  static create(opts: { maxRequests: number; windowMs: number; name: string }) {
    const rate = opts.maxRequests / (opts.windowMs / 1000);
    return new RateLimiter(opts.maxRequests, rate, opts.name);
  }

  private refill() {
    const elapsed = (Date.now() - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = Date.now();
  }

  // try to get a token, returns false if none left
  async acquire(): Promise<boolean> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens--;
      return true;
    }
    return false;
  }

  // wait until we can get a token (blocks if needed)
  async waitForToken(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens--;
      return;
    }

    // backoff gets worse with more failures (up to 2^5 = 32x)
    const wait = (1 / this.refillRate) * 1000 * Math.pow(2, Math.min(this.failures, 5));
    logger.debug(`[${this.name}] waiting ${wait.toFixed(0)}ms`);

    await new Promise(r => setTimeout(r, wait));
    return this.waitForToken(); // recursive, try again
  }

  reportSuccess() {
    this.failures = 0;
  }

  reportFailure() {
    this.failures++;
    logger.warn(`[${this.name}] failure #${this.failures}`);
  }

  getAvailableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  // get delay for exponential backoff with some jitter
  // jitter helps prevent thundering herd when multiple clients retry at same time
  getBackoffDelay(attempt: number): number {
    const delay = Math.min(1000 * Math.pow(2, attempt), 30000); // cap at 30s
    return delay + Math.random() * 1000; // add up to 1s jitter
  }
}

/**
 * retry wrapper - just runs a function with retries
 * 
 * usage:
 *   const data = await withRetry(() => fetchStuff(), { maxRetries: 3 });
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxRetries?: number; baseDelay?: number; onRetry?: (err: Error, n: number) => void } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelay = 1000, onRetry } = opts;
  let lastErr: Error;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (i === maxRetries) throw lastErr;

      // exponential backoff with jitter
      const delay = Math.min(baseDelay * Math.pow(2, i), 30000) + Math.random() * 1000;
      onRetry?.(lastErr, i);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr!;
}

export default RateLimiter;
