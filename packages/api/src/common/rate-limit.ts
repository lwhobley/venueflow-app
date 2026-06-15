import { HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
