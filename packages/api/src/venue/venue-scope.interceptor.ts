import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { resolveVenueSubscriptionStatus } from '../billing/subscription-status';
import { bindAiUsageContext } from '../common/ai-usage-context';
import { SKIP_VENUE_SCOPE_KEY } from './skip-venue-scope.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { runWithoutTenant, runWithTenant } from '../prisma/tenant-context';

export type VenueScopedRequest = AuthenticatedRequest & {
  venueScope?: {
    profileId: string;
    fullName: string;
    venueId: string;
    venueName: string;
    role: string;
    allAccess: boolean;
    subscriptionStatus: string | null;
    trialEndsAt: Date | null;
  };
};

@Injectable()
export class VenueScopeInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService, private readonly reflector: Reflector) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_VENUE_SCOPE_KEY, [context.getHandler(), context.getClass()]);
    if (skip) {
      // AuthGuard has already called enterTenant() — AsyncLocalStorage.enterWith,
      // which persists for the rest of the request. Simply not binding more
      // context here left the Prisma tenant extension active, so a route marked
      // @SkipVenueScope() still had every query narrowed to one venue. That
      // silently truncated the cross-venue reads these routes exist to perform
      // (e.g. a manager of two venues seeing join requests for only one).
      return new Observable<unknown>((subscriber) =>
        runWithoutTenant(() => next.handle().subscribe(subscriber)),
      );
    }

    const request = context.switchToHttp().getRequest<VenueScopedRequest>();
    if (request.venueScope) {
      return this.bindRequestContexts(request.venueScope, next);
    }

    const user = request.user;
    if (!user?.sub) return next.handle();
    const rawVenueHeader = request.headers['x-venue-id'];
    const requestedVenueId = typeof rawVenueHeader === 'string' && rawVenueHeader.trim()
      ? rawVenueHeader.trim()
      : undefined;

    let profile: VenueScopedRequest['verifiedVenueProfile'] | null = request.verifiedVenueProfile;
    if (!profile && requestedVenueId) {
      profile = await this.prisma.profile.findFirst({
        where: {
          userId: user.sub,
          venueId: requestedVenueId,
          OR: [{ membershipStatus: null }, { membershipStatus: 'active' }],
        },
        include: { venue: { select: { id: true, name: true, subscriptionStatus: true } } },
      });
      if (!profile) {
        throw new ForbiddenException('You do not have an active membership at the requested venue.');
      }
    }
    if (!profile && !requestedVenueId) {
      profile = await this.prisma.profile.findFirst({
        where: {
          userId: user.sub,
          venueId: { not: null },
          OR: [{ membershipStatus: null }, { membershipStatus: 'active' }],
        },
        include: { venue: { select: { id: true, name: true, subscriptionStatus: true } } },
        orderBy: { createdAt: 'asc' },
      });
    }
    if (!profile?.venueId || !profile.venue) return next.handle();

    const subscriptionStatus = await resolveVenueSubscriptionStatus(this.prisma, { venueId: profile.venueId, venueStatus: profile.venue.subscriptionStatus, trialEndsAt: profile.trialEndsAt });
    request.venueScope = { profileId: profile.id, fullName: profile.fullName, venueId: profile.venueId, venueName: profile.venue.name, role: profile.role, allAccess: profile.allAccess, subscriptionStatus, trialEndsAt: profile.trialEndsAt ?? null };

    return this.bindRequestContexts(request.venueScope, next);
  }

  /** Bind both deferred RxJS execution contexts and restore them on teardown. */
  private bindRequestContexts(scope: NonNullable<VenueScopedRequest['venueScope']>, next: CallHandler) {
    return new Observable<unknown>((subscriber) =>
      runWithTenant(scope.venueId, () =>
        bindAiUsageContext(
          { venueId: scope.venueId, profileId: scope.profileId, prisma: this.prisma },
          () => next.handle(),
        ).subscribe(subscriber),
      ),
    );
  }
}
