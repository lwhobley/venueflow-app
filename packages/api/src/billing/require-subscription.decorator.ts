import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import { SubscriptionGuard } from './subscription.guard';

export const SUBSCRIPTION_TIER_KEY = 'subscriptionTier';

/**
 * Tier options:
 *  - 'active' allows trialing and active subscriptions
 *  - 'paid' requires an active paid subscription
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
