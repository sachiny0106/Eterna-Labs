import { RateLimiter, withRetry } from '../../src/utils/rateLimiter';

describe('RateLimiter', () => {
  // Helper to create limiter quickly
  const createLimiter = (max = 10, windowMs = 1000) => 
    RateLimiter.create({ maxRequests: max, windowMs, name: 'test' });

  it('allows requests within limit', async () => {
    const limiter = createLimiter(10, 1000);
    for (let i = 0; i < 5; i++) {
      expect(await limiter.acquire()).toBe(true);
    }
  });

  it('rejects when limit exceeded', async () => {
    const limiter = createLimiter(3, 10000); // slow refill
    for (let i = 0; i < 3; i++) await limiter.acquire();
    expect(await limiter.acquire()).toBe(false);
  });

  it('refills tokens over time', async () => {
    const limiter = createLimiter(10, 100); // fast refill
    await limiter.acquire();
    await limiter.acquire();
    const before = limiter.getAvailableTokens();
    await new Promise(r => setTimeout(r, 150));
    expect(limiter.getAvailableTokens()).toBeGreaterThan(before);
  });

  it('resets backoff on success', () => {
    const limiter = createLimiter();
    limiter.reportFailure();
    limiter.reportFailure();
    limiter.reportSuccess();
    expect(limiter.getBackoffDelay(0)).toBeLessThan(2000);
  });

  it('calculates exponential backoff', () => {
    const limiter = createLimiter();
    const d0 = limiter.getBackoffDelay(0);
    const d1 = limiter.getBackoffDelay(1);
    const d2 = limiter.getBackoffDelay(2);
    expect(d1).toBeGreaterThan(d0);
    expect(d2).toBeGreaterThan(d1);
  });

  it('caps backoff at 30s', () => {
    const limiter = createLimiter();
    expect(limiter.getBackoffDelay(10)).toBeLessThanOrEqual(31000);
  });
});

describe('withRetry', () => {
  it('succeeds on first try', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    expect(await withRetry(fn)).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries and eventually succeeds', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValue('ok');
    
    expect(await withRetry(fn, { maxRetries: 3, baseDelay: 10 })).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after max retries', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always fails'));
    await expect(withRetry(fn, { maxRetries: 2, baseDelay: 10 })).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('calls onRetry callback', async () => {
    const onRetry = jest.fn();
    const fn = jest.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValue('ok');
    
    await withRetry(fn, { maxRetries: 2, baseDelay: 10, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
