import { createHmac, timingSafeEqual } from 'crypto';

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

/**
 * Verifies a Stripe webhook signature without the Stripe SDK.
 *
 * Stripe signs `${timestamp}.${rawBody}` with HMAC-SHA256 using the endpoint's
 * signing secret and sends `Stripe-Signature: t=<ts>,v1=<hex>[,v1=<hex>...]`.
 * We recompute the HMAC, compare in constant time, and reject signatures
 * outside the tolerance window (replay protection).
 */
export function verifyStripeSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
  secret: string | undefined,
  toleranceSeconds = 300,
): boolean {
  if (!rawBody || !signatureHeader || !secret) return false;

  const parts = signatureHeader.split(',').reduce<{ t?: string; v1: string[] }>(
    (acc, part) => {
      const [key, value] = part.split('=');
      if (key === 't') acc.t = value;
      else if (key === 'v1' && value) acc.v1.push(value);
      return acc;
    },
    { v1: [] },
  );
  if (!parts.t || parts.v1.length === 0) return false;

  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;

  const expected = createHmac('sha256', secret)
    .update(`${parts.t}.${rawBody.toString('utf8')}`, 'utf8')
    .digest();
  // A signed payload may carry multiple v1 signatures (during secret rotation);
  // accept if any matches.
  return parts.v1.some((candidate) => {
    let candidateBuf: Buffer;
    try {
      candidateBuf = Buffer.from(candidate, 'hex');
    } catch {
      return false;
    }
    return candidateBuf.length === expected.length && timingSafeEqual(candidateBuf, expected);
  });
}
