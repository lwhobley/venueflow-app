import type { Doc } from '../_generated/dataModel';
import { getAuthUserId } from '@convex-dev/auth/server';
import { isAllAccessAccount } from '../permissions';

// Returns true when the authenticated caller is an all-access account. Used to
// bypass subscription gates for the internal QA/all-access account. Resolves
// false (no bypass) in unauthenticated contexts such as webhooks.
async function callerIsAllAccess(ctx: any): Promise<boolean> {
  try {
    const userId = await getAuthUserId(ctx);
    if (!userId) return false;
    const profile = await ctx.db
      .query('profiles')
      .withIndex('by_userId', (q: any) => q.eq('userId', userId))
      .unique();
    return isAllAccessAccount(profile?.email);
  } catch {
    return false;
  }
}

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired' | 'paused';
export type SubscriptionPlatform = 'stripe' | 'apple' | null;
export type SubscriptionRequiredReason = 'trial_expired' | 'payment_failed' | 'cancelled' | 'never_subscribed';

export class SubscriptionRequiredError extends Error {
  reason: SubscriptionRequiredReason;

  constructor(reason: SubscriptionRequiredReason) {
    super('Subscription required');
    this.name = 'SubscriptionRequiredError';
    this.reason = reason;
  }
}

export const subscriptionAllowlist = {
  queries: ['auth.me', 'auth.getSession', 'venues.getMine', 'subscriptions.getForVenue', 'invoices.listForVenue', 'paymentMethods.listForVenue'],
  mutations: ['auth.*', 'users.updateProfile', 'users.updatePassword', 'billing.createStripeCheckoutSession', 'billing.createStripeBillingPortalSession', 'billing.verifyAppleTransaction', 'billing.resumeStripeSubscription', 'billing.cancelStripeSubscription', 'venues.deleteOwnVenue'],
  webhooks: ['stripe', 'apple', 'toast', 'opentable', 'resy'],
} as const;

export function reasonFromStatus(status: Doc<'venues'>['subscriptionStatus'] | null | undefined, hasSubscriptionRow: boolean): SubscriptionRequiredReason {
  if (!hasSubscriptionRow || status == null) return 'never_subscribed';
  if (status === 'trialing') return 'never_subscribed';
  if (status === 'active') return 'never_subscribed';
  if (status === 'past_due') return 'payment_failed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'expired') return 'trial_expired';
  return 'cancelled';
}

export async function requireActiveSubscription(ctx: any, venueId: string) {
  const venue = await ctx.db.get(venueId);
  const status = venue?.subscriptionStatus ?? null;
  if (status === 'trialing' || status === 'active') {
    return venue;
  }
  // All-access (QA) account bypasses the subscription gate server-side.
  if (await callerIsAllAccess(ctx)) {
    return venue;
  }
  throw new SubscriptionRequiredError(venue ? reasonFromStatus(status, true) : 'never_subscribed');
}

// Premium features (Integrations, CRM) require an active paid subscription.
// Trial accounts are blocked server-side; use requireActiveSubscription for
// features that are intentionally available during the trial.
export async function requirePaidSubscription(ctx: any, venueId: string) {
  const venue = await ctx.db.get(venueId);
  const status = venue?.subscriptionStatus ?? null;
  if (status === 'active') {
    return venue;
  }
  // All-access (QA) account bypasses the subscription gate server-side.
  if (await callerIsAllAccess(ctx)) {
    return venue;
  }
  throw new SubscriptionRequiredError(venue ? reasonFromStatus(status, true) : 'never_subscribed');
}

export async function canAccessBilling(ctx: any, venueId: string) {
  return await requireActiveSubscription(ctx, venueId);
}
