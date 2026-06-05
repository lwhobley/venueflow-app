import { SetMetadata } from '@nestjs/common';

export const SUBSCRIPTION_TIER_KEY = 'subscriptionTier';

/**
 * Tier options mirror the two checks in convex/billing/shared.ts:
 *  - 'active'  → requireActiveSubscription  (trialing + active pass)
 *  - 'paid'    → requirePaidSubscription     (active only; trial blocked)
 */
export type SubscriptionTier = 'active' | 'paid';

/**
 * Requires the caller's venue to have an active (or better) subscription.
 * SubscriptionGuard is registered as APP_GUARD #3 — no UseGuards needed here.
 *
 * @param tier 'active' (default) allows trialing + paid. 'paid' blocks trials.
 */
export function RequireSubscription(tier: SubscriptionTier = 'active') {
  return SetMetadata(SUBSCRIPTION_TIER_KEY, tier);
}
