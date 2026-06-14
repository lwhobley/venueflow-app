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
    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      select: { userId: true, expiresAt: true },
    });
    if (!session || session.userId !== payload.sub || session.expiresAt.getTime() <= Date.now()) {
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
