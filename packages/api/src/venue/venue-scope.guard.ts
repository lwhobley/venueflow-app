import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { SKIP_VENUE_SCOPE_KEY } from './skip-venue-scope.decorator';
import { PrismaService } from '../prisma/prisma.service';

export type VenueScopedRequest = AuthenticatedRequest & {
  venueScope?: {
    profileId: string;
    venueId: string;
    role: string;
    allAccess: boolean;
    subscriptionStatus: string | null;
    trialEndsAt: Date | null;
  };
};

/**
 * Resolves the caller's profile and venue once per request and attaches the
 * result to `request.venueScope`. Runs as a global APP_GUARD (after AuthGuard,
 * before SubscriptionGuard) so the scope is available to all downstream guards.
 *
 * Guards run before interceptors in the NestJS lifecycle, so this must be a
 * guard — not an interceptor — for SubscriptionGuard to read the scope.
 *
 * Skip with @SkipVenueScope() for routes that run before a profile exists
 * (e.g. bootstrapProfile, getMe).
 */
@Injectable()
export class VenueScopeGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_VENUE_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return true;
    }

    const request = context.switchToHttp().getRequest<VenueScopedRequest>();
    const user = request.user;
    if (!user?.sub) {
      return true;
    }

    const profile = await this.prisma.profile.findFirst({
      where: { userId: user.sub },
      include: { venue: { select: { id: true, subscriptionStatus: true } } },
    });

    if (profile?.venueId && profile.venue) {
      request.venueScope = {
        profileId: profile.id,
        venueId: profile.venueId,
        role: profile.role,
        allAccess: profile.allAccess,
        subscriptionStatus: profile.venue.subscriptionStatus ?? null,
        trialEndsAt: profile.trialEndsAt ?? null,
      };
    }

    return true;
  }
}
