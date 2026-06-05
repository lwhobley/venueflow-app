import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { SKIP_VENUE_SCOPE_KEY } from './skip-venue-scope.decorator';
import { PrismaService } from '../prisma/prisma.service';

export type VenueScopedRequest = AuthenticatedRequest & {
  venueScope?: {
    profileId: string;
    fullName: string;
    venueId: string;
    role: string;
    allAccess: boolean;
    subscriptionStatus: string | null;
    trialEndsAt: Date | null;
  };
};

/**
 * Resolves the caller's profile and venue once per request and attaches the
 * result to `request.venueScope`. Controllers and guards downstream read from
 * this object instead of re-querying the DB.
 *
 * Skip with @SkipVenueScope() for routes that intentionally run before a
 * profile/venue exists (e.g. bootstrapProfile, getMe).
 */
@Injectable()
export class VenueScopeInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_VENUE_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<VenueScopedRequest>();
    const user = request.user;
    if (!user?.sub) {
      return next.handle();
    }

    const profile = await this.prisma.profile.findFirst({
      where: { userId: user.sub },
      include: { venue: { select: { id: true, subscriptionStatus: true } } },
    });

    if (!profile?.venueId || !profile.venue) {
      return next.handle();
    }

    request.venueScope = {
      profileId: profile.id,
      fullName: profile.fullName,
      venueId: profile.venueId,
      role: profile.role,
      allAccess: profile.allAccess,
      subscriptionStatus: profile.venue.subscriptionStatus ?? null,
      trialEndsAt: profile.trialEndsAt ?? null,
    };

    return next.handle();
  }
}
