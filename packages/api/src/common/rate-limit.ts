import { HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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

/**
 * Shared fixed-window limiter backed by Postgres so limits still hold when the
 * API runs multiple replicas.
 */
export async function assertWithinSharedRateLimit(
  prisma: PrismaService,
  key: string,
  max: number,
  windowMs: number,
  message = 'Too many attempts. Try again later.',
) {
  const now = new Date();
  const nextResetAt = new Date(now.getTime() + windowMs);
  await maybeCleanupExpiredBuckets(prisma, now);
  const rows = await prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    INSERT INTO "RateLimitBucket" ("key", "count", "resetAt")
    VALUES (${key}, 1, ${nextResetAt})
    ON CONFLICT ("key") DO UPDATE
    SET
      "count" = CASE
        WHEN "RateLimitBucket"."resetAt" <= ${now} THEN 1
        ELSE "RateLimitBucket"."count" + 1
      END,
      "resetAt" = CASE
        WHEN "RateLimitBucket"."resetAt" <= ${now} THEN ${nextResetAt}
        ELSE "RateLimitBucket"."resetAt"
      END
    RETURNING "count"
  `);
  if ((rows[0]?.count ?? 0) > max) {
    throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

let lastCleanupAt = 0;

async function maybeCleanupExpiredBuckets(prisma: PrismaService, now: Date) {
  if (now.getTime() - lastCleanupAt < 5 * 60 * 1000) {
    return;
  }
  lastCleanupAt = now.getTime();
  await prisma.rateLimitBucket.deleteMany({
    where: {
      resetAt: { lte: now },
    },
  });
}
