import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

type TxClient = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

/**
 * Run a Serializable transaction with bounded retries for Postgres
 * serialization failures (P2034 / SQLSTATE 40001). Without retries, two
 * concurrent writers occasionally see 500s from a transient conflict that
 * would succeed if simply rerun. After exhausting retries, surfaces a 409
 * so the client can re-attempt with fresh state.
 */
export async function withSerializableRetry<T>(
  prisma: PrismaService,
  fn: (tx: TxClient) => Promise<T>,
  options: { maxAttempts?: number; conflictMessage?: string } = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const conflictMessage =
    options.conflictMessage ?? 'Another change was applied at the same time. Please try again.';
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (err) {
      lastErr = err;
      if (!isSerializationFailure(err)) throw err;
      if (attempt === maxAttempts) break;
      // Exponential backoff with jitter: 20ms, 60ms, 140ms…
      const base = 20 * 2 ** (attempt - 1);
      const jitter = Math.floor(Math.random() * base);
      await new Promise((resolve) => setTimeout(resolve, base + jitter));
    }
  }
  throw new ConflictException(conflictMessage);
}

function isSerializationFailure(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') return true;
  // Postgres raw code surfaces here when Prisma can't map it.
  const meta = (err as { meta?: { code?: string } }).meta;
  if (meta?.code === '40001') return true;
  return false;
}
