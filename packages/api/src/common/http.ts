import type { Request } from 'express';

// With `trust proxy` enabled, Express strips the trusted hop and sets
// request.ip to the real client address. Manual XFF parsing trusts the
// attacker-controlled first entry instead.
export function getClientIp(request: Request) {
  return request.ip || 'unknown';
}
