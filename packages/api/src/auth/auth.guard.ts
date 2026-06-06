import {
  CanActivate,
  ExecutionContext,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import jwksRsa from 'jwks-rsa';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator';

export type AuthUser = {
  sub: string;
  email?: string;
  name?: string;
  role?: string;
};

export type AuthenticatedRequest = Request & {
  user?: AuthUser;
};

@Injectable()
export class AuthGuard implements CanActivate, OnModuleInit {
  private jwksClient: jwksRsa.JwksClient | null = null;

  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const convexSiteUrl = this.config.get<string>('CONVEX_SITE_URL');
    if (convexSiteUrl) {
      this.jwksClient = jwksRsa({
        jwksUri: `${convexSiteUrl}/.well-known/jwks.json`,
        cache: true,
        cacheMaxEntries: 5,
        cacheMaxAge: 10 * 60 * 1000,
        rateLimit: true,
      });
    }
  }

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
      payload = await this.verifyToken(token);
    } catch {
      throw new UnauthorizedException('Invalid bearer token');
    }

    if (!payload?.sub) {
      throw new UnauthorizedException('Token is missing a subject claim');
    }

    request.user = payload;
    return true;
  }

  private async verifyToken(token: string): Promise<AuthUser> {
    const decoded = this.jwt.decode(token, { complete: true }) as {
      header: { alg?: string; kid?: string };
    } | null;

    if (decoded?.header?.alg === 'RS256' && this.jwksClient) {
      if (!decoded.header.kid) {
        throw new Error('RS256 token is missing kid header — cannot select signing key');
      }
      const signingKey = await this.jwksClient.getSigningKey(decoded.header.kid);
      const publicKey = signingKey.getPublicKey();
      return await this.jwt.verifyAsync<AuthUser>(token, {
        secret: publicKey,
        algorithms: ['RS256'],
      });
    }

    return await this.jwt.verifyAsync<AuthUser>(token);
  }

  private getBearerToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header) return null;
    const [scheme, token] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && token ? token : null;
  }
}
