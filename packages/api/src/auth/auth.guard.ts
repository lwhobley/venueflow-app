import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator';
import { PrismaService } from '../prisma/prisma.service';

export type AuthUser = {
  sub: string;
  email?: string;
  name?: string;
  role?: string;
  // Session id (present on tokens issued after revocable sessions shipped). When
  // set, the matching Session row must still exist and be unexpired.
  sid?: string;
};

export type AuthenticatedRequest = Request & {
  user?: AuthUser;
};

// Short TTL on session lookups so revocation propagates within seconds
// while still saving a DB round-trip per request on hot paths.
const SESSION_CACHE_TTL_MS = 30_000;
type CachedSession = { userId: string; expiresAt: number; cachedAt: number };
const sessionCache = new Map<string, CachedSession>();

/** Drop a session from the in-process cache so logout takes effect immediately. */
export function invalidateCachedSession(sessionId: string): void {
  sessionCache.delete(sessionId);
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.getBearerToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: AuthUser;
    try {
      payload = await this.jwt.verifyAsync<AuthUser>(token);
    } catch {
      throw new UnauthorizedException('Invalid bearer token');
    }

    if (!payload?.sub) {
      throw new UnauthorizedException('Token is missing a subject claim');
    }

    // Every accepted token must be backed by a revocable Session row. This lets
    // logout, password reset, and account deletion invalidate access
    // immediately instead of waiting for JWT expiry.
    if (!payload.sid) {
      throw new UnauthorizedException('Session is no longer valid. Please sign in again.');
    }
    const now = Date.now();
    const cached = sessionCache.get(payload.sid);
    let session: { userId: string; expiresAt: number } | null;
    if (cached && now - cached.cachedAt < SESSION_CACHE_TTL_MS && cached.expiresAt > now) {
      session = { userId: cached.userId, expiresAt: cached.expiresAt };
    } else {
      const row = await this.prisma.session.findUnique({
        where: { id: payload.sid },
        select: { userId: true, expiresAt: true },
      });
      session = row ? { userId: row.userId, expiresAt: row.expiresAt.getTime() } : null;
      if (session) {
        sessionCache.set(payload.sid, { userId: session.userId, expiresAt: session.expiresAt, cachedAt: now });
      } else {
        sessionCache.delete(payload.sid);
      }
      // Opportunistic cleanup to keep the map from growing unbounded.
      if (sessionCache.size > 5000) {
        for (const [key, value] of sessionCache) {
          if (now - value.cachedAt > SESSION_CACHE_TTL_MS || value.expiresAt <= now) {
            sessionCache.delete(key);
          }
        }
      }
    }
    if (!session || session.userId !== payload.sub || session.expiresAt <= now) {
      sessionCache.delete(payload.sid);
      throw new UnauthorizedException('Session is no longer valid. Please sign in again.');
    }

    request.user = payload;
    return true;
  }

  private getBearerToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header) return null;
    const [scheme, token] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && token ? token : null;
  }
}
