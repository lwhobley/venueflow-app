import type { Request } from 'express';

export function getClientIp(request: Request) {
  const forwarded = request.headers['x-forwarded-for'];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return firstForwarded?.trim() || request.ip || 'unknown';
}
