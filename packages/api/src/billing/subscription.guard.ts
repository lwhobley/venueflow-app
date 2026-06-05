import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { VenueScopedRequest } from '../venue/venue-scope.guard';
import { SUBSCRIPTION_TIER_KEY, SubscriptionTier } from './require-subscription.decorator';

/**
 * Guards routes behind an active subscription check, mirroring the behaviour
 * of requireActiveSubscription / requirePaidSubscription in convex/billing/shared.ts.
 *
 * Requires VenueScopeInterceptor to have run first (reads request.venueScope).
 *
 * Activated with @RequireSubscription() (any active/trialing subscription) or
 * @RequireSubscription('paid') (paid-only, no trial). Routes without the
 * decorator are not gated.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const tier = this.reflector.getAllAndOverride<SubscriptionTier | undefined>(
      SUBSCRIPTION_TIER_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!tier) {
      return true;
    }

    const request = context.switchToHttp().getRequest<VenueScopedRequest>();
    const scope = request.venueScope;

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
}

function reasonMessage(status: string | null): string {
  if (status === 'trialing') return 'A paid subscription is required for this feature';
  if (status === 'past_due') return 'Subscription payment failed — please update your billing details';
  if (status === 'paused' || status === 'cancelled') return 'Subscription cancelled — please resubscribe';
  if (status === 'expired') return 'Trial has expired — please subscribe to continue';
  return 'An active subscription is required';
}
