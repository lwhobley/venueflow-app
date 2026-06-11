import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Simple in-process fixed-window rate limiter.
 *
 * NOTE: per-instance only. If the API ever runs more than one replica, replace
 * with a shared store (e.g. Redis via @nestjs/throttler) — limits here do not
 * apply across instances.
 */
export function createRateLimiter(max: number, windowMs: number) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  let lastSweepAt = Date.now();

  return function assertWithinRateLimit(key: string, message = 'Too many attempts. Try again later.') {
    const now = Date.now();
    // Periodically drop expired buckets so the map cannot grow without bound.
    if (now - lastSweepAt > windowMs) {
      lastSweepAt = now;
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(bucketKey);
      }
    }
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    if (current.count >= max) {
      throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
    }
    current.count += 1;
  };
}
