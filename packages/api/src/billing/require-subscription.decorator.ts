import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import { SubscriptionGuard } from './subscription.guard';

export const SUBSCRIPTION_TIER_KEY = 'subscriptionTier';

/**
 * Tier options mirror the two checks in convex/billing/shared.ts:
 *  - 'active'  → requireActiveSubscription  (trialing + active pass)
 *  - 'paid'    → requirePaidSubscription     (active only; trial blocked)
 */
export type SubscriptionTier = 'active' | 'paid';

/**
 * Requires the caller's venue to have an active (or better) subscription.
 *
 * @param tier 'active' (default) allows trialing + paid. 'paid' blocks trials.
 *
 * @example
 * @RequireSubscription()
 * @Get('clock-board')
 * async getClockBoard() { ... }
 *
 * @example
 * @RequireSubscription('paid')
 * @Get('crm/leads')
 * async listLeads() { ... }
 */
export function RequireSubscription(tier: SubscriptionTier = 'active') {
  return applyDecorators(
    SetMetadata(SUBSCRIPTION_TIER_KEY, tier),
    UseGuards(SubscriptionGuard),
  );
}
