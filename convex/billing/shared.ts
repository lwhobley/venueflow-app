import type { Doc } from '../_generated/dataModel';

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

export async function requireActiveSubscription(ctx: { db: { get: (id: string) => Promise<Doc<'venues'> | null> } }, venueId: string) {
  const venue = await ctx.db.get(venueId);
  if (!venue) {
    throw new SubscriptionRequiredError('never_subscribed');
  }
  const status = venue.subscriptionStatus ?? null;
  if (status === 'trialing' || status === 'active') {
    return venue;
  }
  throw new SubscriptionRequiredError(reasonFromStatus(status, true));
}

export async function canAccessBilling(ctx: { db: { get: (id: string) => Promise<Doc<'venues'> | null> } }, venueId: string) {
  return await requireActiveSubscription(ctx, venueId);
}
