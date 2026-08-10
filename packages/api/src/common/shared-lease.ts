import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { maybeCleanupExpiredBuckets } from './rate-limit';

/**
 * Atomically claim a short-lived, cross-instance lease in Postgres.
 *
 * RateLimitBucket already provides a keyed expiry store shared by every API
 * replica. A conditional ON CONFLICT update lets exactly one caller insert or
 * renew an expired key; callers observing a live lease receive no row.
 * Expired lease keys (lease:*) are periodically cleaned up via RateLimitBucket pruning.
 */
export async function tryAcquireSharedLease(
  prisma: PrismaService,
  key: string,
  ttlMs: number,
  now = new Date(),
): Promise<boolean> {
  await maybeCleanupExpiredBuckets(prisma, now);
  const resetAt = new Date(now.getTime() + ttlMs);
  const rows = await prisma.$queryRaw<Array<{ key: string }>>(Prisma.sql`
    INSERT INTO "RateLimitBucket" ("key", "count", "resetAt")
    VALUES (${`lease:${key}`}, 1, ${resetAt})
    ON CONFLICT ("key") DO UPDATE
    SET "count" = 1, "resetAt" = EXCLUDED."resetAt"
    WHERE "RateLimitBucket"."resetAt" <= ${now}
    RETURNING "key"
  `);
  return rows.length === 1;
}
