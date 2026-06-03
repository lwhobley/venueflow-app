import type { Doc } from '../_generated/dataModel';
import { getAuthUserId } from '@convex-dev/auth/server';

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired' | 'paused';
export type SubscriptionPlatform = 'stripe' | 'apple' | null;
export type SubscriptionRequiredReason = 'trial_expired' | 'trial_active' | 'payment_failed' | 'cancelled' | 'never_subscribed';

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
  // A live trial that is blocked from a *paid-only* feature: the caller must
  // upgrade, not "resubscribe". An active subscription only reaches here on the
  // paid-feature path; treat both as an upgrade prompt rather than a dead end.
  if (status === 'trialing' || status === 'active') return 'trial_active';
  if (status === 'past_due') return 'payment_failed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'paused') return 'cancelled';
  if (status === 'expired') return 'trial_expired';
  return 'cancelled';
}

type SubscriptionCtx = {
  db: {
    get: (id: string) => Promise<Doc<'venues'> | Doc<'profiles'> | null>;
    query: (table: 'profiles') => {
      withIndex: (
        index: 'by_userId',
        callback: (query: { eq: (field: 'userId', value: unknown) => unknown }) => unknown,
      ) => { unique: () => Promise<Doc<'profiles'> | null> };
    };
  };
};

async function getCallerProfile(ctx: SubscriptionCtx) {
  const userId = await getAuthUserId(ctx as any);
  if (!userId) return null;
  return await ctx.db
    .query('profiles')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique();
}

async function hasAllAccessForVenue(ctx: SubscriptionCtx, venueId: string) {
  const profile = await getCallerProfile(ctx);
  return profile?.allAccess === true && profile.venueId === venueId;
}

export async function requireActiveSubscription(ctx: SubscriptionCtx, venueId: string) {
  const venue = (await ctx.db.get(venueId)) as Doc<'venues'> | null;
  if (!venue) {
    throw new SubscriptionRequiredError('never_subscribed');
  }
  if (await hasAllAccessForVenue(ctx, venueId)) {
    return venue;
  }
  const status = venue.subscriptionStatus ?? null;
  if (status === 'trialing' || status === 'active') {
    return venue;
  }
  throw new SubscriptionRequiredError(reasonFromStatus(status, true));
}

// Premium features (Integrations, CRM) require an active paid subscription.
// Trial accounts are blocked server-side; use requireActiveSubscription for
// features that are intentionally available during the trial.
export async function requirePaidSubscription(ctx: SubscriptionCtx, venueId: string) {
  const venue = (await ctx.db.get(venueId)) as Doc<'venues'> | null;
  if (!venue) {
    throw new SubscriptionRequiredError('never_subscribed');
  }
  if (await hasAllAccessForVenue(ctx, venueId)) {
    return venue;
  }
  const status = venue.subscriptionStatus ?? null;
  if (status === 'active') {
    return venue;
  }
  throw new SubscriptionRequiredError(reasonFromStatus(status, true));
}

export async function canAccessBilling(ctx: SubscriptionCtx, venueId: string) {
  return await requireActiveSubscription(ctx, venueId);
}
