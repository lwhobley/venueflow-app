import { action, internalMutation, internalQuery, mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { getAuthUserId } from '@convex-dev/auth/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';

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

const stripeSessionValue = v.object({ url: v.string() });

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

function isBillingAdmin(role: string) {
  return role === 'admin' || role === 'owner';
}

function appUrl() {
  return process.env.APP_PUBLIC_URL || process.env.EXPO_PUBLIC_APP_URL || 'http://localhost:8081';
}

function stripeSecret() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  return key;
}

function stripePriceId() {
  const price = process.env.STRIPE_PRICE_ID;
  if (!price) throw new Error('STRIPE_PRICE_ID is not configured');
  return price;
}

async function stripePost(path: string, params: Record<string, string>) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeSecret()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2026-02-25.clover',
    },
    body: new URLSearchParams(params),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json?.error?.message ?? 'Stripe request failed');
  return json;
}

function stripeMs(seconds: unknown) {
  return typeof seconds === 'number' ? seconds * 1000 : null;
}

function mapStripeStatus(status: string | undefined) {
  switch (status) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
      return 'past_due';
    case 'canceled':
      return 'cancelled';
    case 'incomplete_expired':
      return 'expired';
    default:
      return 'past_due';
  }
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

export const getStripeBillingContext = internalQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      venueId: v.id('venues'),
      venueName: v.string(),
      email: v.string(),
      externalCustomerId: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile?.venueId || !isBillingAdmin(profile.role)) return null;
    const venue = await (ctx as AnyCtx).db.get(profile.venueId);
    if (!venue) return null;
    const subscription = await (ctx as AnyCtx).db.query('subscriptions').withIndex('by_venue', (q: any) => q.eq('venueId', profile.venueId)).unique();
    if (!subscription) return null;
    return {
      venueId: profile.venueId,
      venueName: venue.name,
      email: profile.email,
      externalCustomerId: subscription.externalCustomerId ?? null,
    };
  },
});

export const createStripeCheckoutSession = action({
  args: {},
  returns: stripeSessionValue,
  handler: async (ctx): Promise<{ url: string }> => {
    const context: { venueId: Id<'venues'>; venueName: string; email: string; externalCustomerId: string | null } | null = await ctx.runQuery(
      internal.billing.getStripeBillingContext,
      {},
    );
    if (!context) throw new Error('Only venue owners can start billing');
    const params: Record<string, string> = {
      mode: 'subscription',
      success_url: `${appUrl()}/settings/billing?checkout=success`,
      cancel_url: `${appUrl()}/settings/billing?checkout=cancelled`,
      client_reference_id: context.venueId,
      'line_items[0][price]': stripePriceId(),
      'line_items[0][quantity]': '1',
      'metadata[venueId]': context.venueId,
      'subscription_data[metadata][venueId]': context.venueId,
      'subscription_data[metadata][venueName]': context.venueName,
      allow_promotion_codes: 'true',
    };
    if (context.externalCustomerId) params.customer = context.externalCustomerId;
    else params.customer_email = context.email;
    const session = await stripePost('checkout/sessions', params);
    if (!session.url) throw new Error('Stripe did not return a checkout URL');
    return { url: session.url };
  },
});

export const createStripeBillingPortalSession = action({
  args: {},
  returns: stripeSessionValue,
  handler: async (ctx): Promise<{ url: string }> => {
    const context: { externalCustomerId: string | null } | null = await ctx.runQuery(internal.billing.getStripeBillingContext, {});
    if (!context) throw new Error('Only venue owners can manage billing');
    if (!context.externalCustomerId) throw new Error('No Stripe customer is linked yet');
    const session = await stripePost('billing_portal/sessions', {
      customer: context.externalCustomerId,
      return_url: `${appUrl()}/settings/billing`,
    });
    if (!session.url) throw new Error('Stripe did not return a portal URL');
    return { url: session.url };
  },
});

export const reconcilePaidSubscription = internalMutation({
  args: {
    venueId: v.id('venues'),
    packageRef: v.string(),
    productId: v.optional(v.string()),
    platform: subscriptionPlatformValue,
  },
  returns: billingValue,
  handler: async (ctx, args) => {
    const subscription = await (ctx as AnyCtx).db.query('subscriptions').withIndex('by_venue', (q: any) => q.eq('venueId', args.venueId)).unique();
    if (!subscription) throw new Error('Subscription not found');

    const venue = await (ctx as AnyCtx).db.get(args.venueId);
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

export const handleStripeWebhook = internalMutation({
  args: { event: v.any() },
  returns: v.object({ status: v.string() }),
  handler: async (ctx, args) => {
    const event = args.event;
    const object = event?.data?.object ?? {};
    const venueId = object?.metadata?.venueId ?? object?.client_reference_id;
    let subscription: Doc<'subscriptions'> | null = null;
    if (venueId) {
      subscription = await (ctx as AnyCtx).db.query('subscriptions').withIndex('by_venue', (q: any) => q.eq('venueId', venueId)).unique();
    }
    if (!subscription && object?.id && String(event.type ?? '').startsWith('customer.subscription.')) {
      subscription = await (ctx as AnyCtx).db.query('subscriptions').withIndex('by_external_id', (q: any) => q.eq('externalSubscriptionId', object.id)).unique();
    }
    if (!subscription) return { status: 'skipped' };

    const externalEventId = event.id ?? `${event.type}:${Date.now()}`;
    const duplicate = await (ctx as AnyCtx).db
      .query('subscriptionEvents')
      .withIndex('by_source_external_id', (q: any) => q.eq('source', 'stripe').eq('externalEventId', externalEventId))
      .unique();
    if (duplicate) return { status: 'duplicate' };

    await (ctx as AnyCtx).db.insert('subscriptionEvents', {
      venueId: subscription.venueId,
      source: 'stripe',
      externalEventId,
      eventType: event.type ?? 'unknown',
      payload: event,
      processedAt: Date.now(),
      status: 'processed',
      errorMessage: null,
    });

    const patch: Record<string, unknown> = { updatedAt: Date.now(), platform: 'stripe' };
    if (event.type === 'checkout.session.completed') {
      patch.status = 'active';
      patch.externalCustomerId = object.customer ?? subscription.externalCustomerId;
      patch.externalSubscriptionId = object.subscription ?? subscription.externalSubscriptionId;
      patch.cancelAtPeriodEnd = false;
      patch.cancelledAt = null;
    }
    if (String(event.type ?? '').startsWith('customer.subscription.')) {
      patch.status = mapStripeStatus(object.status);
      patch.externalCustomerId = object.customer ?? subscription.externalCustomerId;
      patch.externalSubscriptionId = object.id ?? subscription.externalSubscriptionId;
      patch.currentPeriodStart = stripeMs(object.current_period_start);
      patch.currentPeriodEnd = stripeMs(object.current_period_end);
      patch.cancelAtPeriodEnd = Boolean(object.cancel_at_period_end);
      patch.cancelledAt = stripeMs(object.canceled_at);
    }
    await (ctx as AnyCtx).db.patch(subscription._id, patch);
    const updated = await (ctx as AnyCtx).db.get(subscription._id);
    if (updated) {
      await (ctx as AnyCtx).db.patch(updated.venueId, {
        subscriptionStatus: updated.status,
        subscriptionPlatform: updated.platform,
      });
    }

    if ((event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') && object.id) {
      const existingInvoice = await (ctx as AnyCtx).db.query('invoices').withIndex('by_stripe_id', (q: any) => q.eq('stripeInvoiceId', object.id)).unique();
      const invoicePayload = {
        venueId: subscription.venueId,
        stripeInvoiceId: object.id,
        amountCents: object.amount_paid ?? object.amount_due ?? 0,
        currency: String(object.currency ?? 'usd').toUpperCase(),
        status: object.status ?? (event.type === 'invoice.paid' ? 'paid' : 'open'),
        invoiceUrl: object.invoice_pdf ?? null,
        hostedInvoiceUrl: object.hosted_invoice_url ?? null,
        periodStart: stripeMs(object.period_start) ?? Date.now(),
        periodEnd: stripeMs(object.period_end) ?? Date.now(),
        createdAt: stripeMs(object.created) ?? Date.now(),
        paidAt: stripeMs(object.status_transitions?.paid_at),
      };
      if (existingInvoice) await (ctx as AnyCtx).db.patch(existingInvoice._id, invoicePayload);
      else await (ctx as AnyCtx).db.insert('invoices', invoicePayload);
    }
    return { status: 'processed' };
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
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || (profile.role !== 'admin' && profile.role !== 'owner')) {
      throw new Error('Not authorized');
    }
    if (args.status === 'active' || args.status === 'trialing') {
      throw new Error('Paid subscription status must be reconciled by a verified billing provider');
    }
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
