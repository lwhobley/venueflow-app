import { timingSafeEqual } from 'crypto';

/**
 * Constant-time secret comparison for webhook authentication. Tolerates missing
 * values and length mismatches without leaking timing information.
 */
export function secretsMatch(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
