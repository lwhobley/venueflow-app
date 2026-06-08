import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { VenueScopedRequest } from '../venue/venue-scope.interceptor';
import { SUBSCRIPTION_TIER_KEY, SubscriptionTier } from './require-subscription.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { resolveVenueSubscriptionStatus } from './subscription-status';

/**
 * Guards routes behind active or paid subscription checks.
 *
 * Requires VenueScopeInterceptor to have run first (reads request.venueScope).
 *
 * Activated with @RequireSubscription() (any active/trialing subscription) or
 * @RequireSubscription('paid') (paid-only, no trial). Routes without the
 * decorator are not gated.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const tier = this.reflector.getAllAndOverride<SubscriptionTier | undefined>(
      SUBSCRIPTION_TIER_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!tier) {
      return true;
    }

    const request = context.switchToHttp().getRequest<VenueScopedRequest>();
    const scope = request.venueScope ?? (await this.resolveVenueScope(request));

    if (!scope) {
      throw new HttpException('No active venue subscription', HttpStatus.PAYMENT_REQUIRED);
    }

    // allAccess profiles (internal/support accounts) bypass billing checks.
    if (scope.allAccess) {
      return true;
    }

    const status = scope.subscriptionStatus;

    if (tier === 'active') {
      // Mirrors: status === 'trialing' || status === 'active'
      if (status === 'trialing' || status === 'active') {
        return true;
      }
      throw new HttpException(reasonMessage(status), HttpStatus.PAYMENT_REQUIRED);
    }

    if (tier === 'paid') {
      // Mirrors requirePaidSubscription: only 'active' passes
      if (status === 'active') {
        return true;
      }
      throw new HttpException(reasonMessage(status), HttpStatus.PAYMENT_REQUIRED);
    }

    return false;
  }

  private async resolveVenueScope(request: VenueScopedRequest) {
    const user = request.user;
    if (!user?.sub) return null;

    const profile = await this.prisma.profile.findFirst({
      where: { userId: user.sub },
      include: { venue: { select: { id: true, subscriptionStatus: true } } },
    });
    if (!profile?.venueId || !profile.venue) return null;

    const subscriptionStatus = await resolveVenueSubscriptionStatus(this.prisma, {
      venueId: profile.venueId,
      venueStatus: profile.venue.subscriptionStatus,
      trialEndsAt: profile.trialEndsAt,
    });

    request.venueScope = {
      profileId: profile.id,
      fullName: profile.fullName,
      venueId: profile.venueId,
      role: profile.role,
      allAccess: profile.allAccess,
      subscriptionStatus,
      trialEndsAt: profile.trialEndsAt ?? null,
    };
    return request.venueScope;
  }
}

function reasonMessage(status: string | null): string {
  if (status === 'trialing') return 'A paid subscription is required for this feature';
  if (status === 'past_due') return 'Subscription payment failed — please update your billing details';
  if (status === 'paused' || status === 'cancelled') return 'Subscription cancelled — please resubscribe';
  if (status === 'expired') return 'Trial has expired — please subscribe to continue';
  return 'An active subscription is required';
}
