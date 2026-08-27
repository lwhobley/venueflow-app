import type { Request } from 'express';

// With `trust proxy` enabled, Express strips the trusted hop and sets
// request.ip to the real client address. Manual XFF parsing trusts the
// attacker-controlled first entry instead.
export function getClientIp(request: Request) {
  return request.ip || 'unknown';
}

/**
 * Normalizes the client-supplied venue-selection header. A duplicated header
 * (`X-Venue-Id: a` sent twice) makes Express parse it as `string[]`, which
 * this rejects rather than passing through to a Prisma `where: { venueId }`
 * filter that expects a scalar.
 */
export function venueIdHeader(headers: Request['headers']): string | undefined {
  const raw = headers?.['x-venue-id'];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}
