import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { getAuthUserId } from '@convex-dev/auth/server';
import type { Id } from './_generated/dataModel';
import { requireActiveSubscription } from './billing/shared';

type Identity = {
  tokenIdentifier: string;
  email?: string | null;
  name?: string | null;
};

// Intentional escape hatch — shared helpers used across query/mutation ctxs.
// See note in convex/app.ts. Tracked for proper typing in the hardening task.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCtx = any;

const subscriptionStatusValue = v.union(v.literal('trialing'), v.literal('active'), v.literal('past_due'), v.literal('cancelled'), v.literal('expired'), v.literal('paused'));
const subscriptionPlatformValue = v.union(v.literal('stripe'), v.literal('apple'), v.null());

const billingValue = v.object({
  venueId: v.id('venues'),
  status: subscriptionStatusValue,
  platform: subscriptionPlatformValue,
  trialStartedAt: v.number(),
  trialEndsAt: v.number(),
  currentPeriodStart: v.union(v.number(), v.null()),
  currentPeriodEnd: v.union(v.number(), v.null()),
  cancelAtPeriodEnd: v.boolean(),
  cancelledAt: v.union(v.number(), v.null()),
  planId: v.string(),
  priceCents: v.number(),
  currency: v.string(),
});

function periodEndForPackage(packageRef: string, now: number) {
  if (packageRef.includes('annual')) {
    return now + 365 * 24 * 60 * 60 * 1000;
  }
  return now + 30 * 24 * 60 * 60 * 1000;
}

async function getProfile(ctx: AnyCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return await ctx.db.query('profiles').withIndex('by_userId', (q: any) => q.eq('userId', userId)).unique();
}

export const getMyBilling = query({
  args: {},
  returns: v.union(v.null(), billingValue),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile?.venueId) return null;
    const subscription = await (ctx as AnyCtx).db.query('subscriptions').withIndex('by_venue', (q: any) => q.eq('venueId', profile.venueId)).unique();
    if (!subscription) return null;
    return {
      venueId: subscription.venueId,
      status: subscription.status,
      platform: subscription.platform,
      trialStartedAt: subscription.trialStartedAt,
      trialEndsAt: subscription.trialEndsAt,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      cancelledAt: subscription.cancelledAt,
      planId: subscription.planId,
      priceCents: subscription.priceCents,
      currency: subscription.currency,
    };
  },
});

export const reconcilePaidSubscription = mutation({
  args: {
    packageRef: v.string(),
    productId: v.optional(v.string()),
    platform: subscriptionPlatformValue,
  },
  returns: billingValue,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('Unauthenticated');
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile?.venueId) throw new Error('Profile is not initialized');

    const subscription = await (ctx as AnyCtx).db.query('subscriptions').withIndex('by_venue', (q: any) => q.eq('venueId', profile.venueId)).unique();
    if (!subscription) throw new Error('Subscription not found');

    const venue = await (ctx as AnyCtx).db.get(profile.venueId);
    if (!venue) throw new Error('Venue not found');

    const now = Date.now();
    const currentPeriodEnd = periodEndForPackage(args.packageRef, now);
    await (ctx as AnyCtx).db.patch(subscription._id, {
      status: 'active',
      platform: args.platform,
      planId: args.packageRef,
      externalSubscriptionId: args.productId ?? subscription.externalSubscriptionId,
      currentPeriodStart: now,
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      updatedAt: now,
    });
    await (ctx as AnyCtx).db.patch(venue._id, {
      subscriptionStatus: 'active',
      subscriptionPlatform: args.platform,
    });

    const updated = await (ctx as AnyCtx).db.get(subscription._id);
    if (!updated) throw new Error('Unable to update subscription');
    return {
      venueId: updated.venueId,
      status: updated.status,
      platform: updated.platform,
      trialStartedAt: updated.trialStartedAt,
      trialEndsAt: updated.trialEndsAt,
      currentPeriodStart: updated.currentPeriodStart,
      currentPeriodEnd: updated.currentPeriodEnd,
      cancelAtPeriodEnd: updated.cancelAtPeriodEnd,
      cancelledAt: updated.cancelledAt,
      planId: updated.planId,
      priceCents: updated.priceCents,
      currency: updated.currency,
    };
  },
});

export const syncVenueSubscription = mutation({
  args: {
    venueId: v.id('venues'),
    status: subscriptionStatusValue,
    platform: subscriptionPlatformValue,
  },
  returns: billingValue,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('Unauthenticated');
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId) throw new Error('Not authorized');
    const subscription = await (ctx as AnyCtx).db.query('subscriptions').withIndex('by_venue', (q: any) => q.eq('venueId', args.venueId)).unique();
    if (!subscription) throw new Error('Subscription not found');
    await (ctx as AnyCtx).db.patch(subscription._id, {
      status: args.status,
      platform: args.platform,
      updatedAt: Date.now(),
    });
    const updated = await (ctx as AnyCtx).db.get(subscription._id);
    if (!updated) throw new Error('Unable to update subscription');
    const venue = await (ctx as AnyCtx).db.get(profile.venueId);
    if (!venue) throw new Error('Venue not found');
    await (ctx as AnyCtx).db.patch(venue._id, {
      subscriptionStatus: args.status,
      subscriptionPlatform: args.platform,
    });
    return {
      venueId: updated.venueId,
      status: updated.status,
      platform: updated.platform,
      trialStartedAt: updated.trialStartedAt,
      trialEndsAt: updated.trialEndsAt,
      currentPeriodStart: updated.currentPeriodStart,
      currentPeriodEnd: updated.currentPeriodEnd,
      cancelAtPeriodEnd: updated.cancelAtPeriodEnd,
      cancelledAt: updated.cancelledAt,
      planId: updated.planId,
      priceCents: updated.priceCents,
      currency: updated.currency,
    };
  },
});