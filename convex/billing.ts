import { action, internalMutation, internalQuery, query } from './_generated/server';
import type { MutationCtx, QueryCtx, ActionCtx } from './_generated/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { getProfileOrNull } from './authz';

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

type BillingPlanId = 'venueflow_starter_15_monthly' | 'venueflow_growth_30_monthly' | 'venueflow_pro_50_monthly';

// Price IDs and payment links are read from Convex env vars so they are never
// committed to source. Set STRIPE_STARTER_PRICE_ID, STRIPE_GROWTH_PRICE_ID,
// and STRIPE_PRO_PRICE_ID in the Convex dashboard (Settings → Environment).
function getBillingPlans() {
  return {
    venueflow_starter_15_monthly: {
      name: 'Starter',
      userLimit: 15,
      priceCents: 7999,
      stripePriceId: process.env.STRIPE_STARTER_PRICE_ID ?? '',
      paymentLink: process.env.STRIPE_STARTER_PAYMENT_LINK ?? '',
    },
    venueflow_growth_30_monthly: {
      name: 'Pro',
      userLimit: 30,
      priceCents: 14999,
      stripePriceId: process.env.STRIPE_GROWTH_PRICE_ID ?? '',
      paymentLink: process.env.STRIPE_GROWTH_PAYMENT_LINK ?? '',
    },
    venueflow_pro_50_monthly: {
      name: 'Enterprise',
      userLimit: 50,
      priceCents: 29999,
      stripePriceId: process.env.STRIPE_PRO_PRICE_ID ?? '',
      paymentLink: process.env.STRIPE_PRO_PAYMENT_LINK ?? '',
    },
  };
}

function planById(planId: string) {
  const plans = getBillingPlans();
  return plans[planId as BillingPlanId] ?? plans.venueflow_starter_15_monthly;
}

function planByStripePrice(priceId: string | null | undefined) {
  if (!priceId) return null;
  const plans = getBillingPlans();
  return Object.entries(plans).find(([, plan]) => plan.stripePriceId === priceId)?.[0] ?? null;
}

function periodEndForPackage(packageRef: string, now: number) {
  if (packageRef.includes('annual')) {
    return now + 365 * 24 * 60 * 60 * 1000;
  }
  return now + 30 * 24 * 60 * 60 * 1000;
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
    case 'paused':
      return 'paused';
    case 'incomplete_expired':
      return 'expired';
    default:
      return status ?? 'past_due';
  }
}

export const getMyBilling = query({
  args: {},
  returns: v.union(v.null(), billingValue),
  handler: async (ctx: QueryCtx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const profile = await getProfileOrNull(ctx);
    if (!profile?.venueId) return null;
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_venue', (q) => q.eq('venueId', profile.venueId!))
      .unique();
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
  handler: async (ctx: QueryCtx) => {
    const profile = await getProfileOrNull(ctx);
    if (!profile?.venueId || !isBillingAdmin(profile.role)) return null;

    const venue = await ctx.db.get(profile.venueId);
    if (!venue) return null;
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_venue', (q) => q.eq('venueId', profile.venueId!))
      .unique();
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
  args: { planId: v.optional(v.string()) },
  returns: stripeSessionValue,
  handler: async (ctx: ActionCtx, args): Promise<{ url: string }> => {
    const context: { venueId: Id<'venues'>; venueName: string; email: string; externalCustomerId: string | null } | null = await ctx.runQuery(
      internal.billing.getStripeBillingContext,
      {},
    );
    if (!context) throw new Error('Only venue owners can start billing');
    const plans = getBillingPlans();
    const selectedPlanId = (args.planId && args.planId in plans ? args.planId : 'venueflow_starter_15_monthly') as BillingPlanId;
    const selectedPlan = plans[selectedPlanId];
    const params: Record<string, string> = {
      mode: 'subscription',
      success_url: `${appUrl()}/settings/billing?checkout=success`,
      cancel_url: `${appUrl()}/settings/billing?checkout=cancelled`,
      client_reference_id: context.venueId,
      'line_items[0][price]': selectedPlan.stripePriceId,
      'line_items[0][quantity]': '1',
      'metadata[venueId]': context.venueId,
      'metadata[planId]': selectedPlanId,
      'subscription_data[metadata][venueId]': context.venueId,
      'subscription_data[metadata][venueName]': context.venueName,
      'subscription_data[metadata][planId]': selectedPlanId,
      'subscription_data[metadata][userLimit]': String(selectedPlan.userLimit),
      'subscription_data[trial_period_days]': '3',
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
  handler: async (ctx: ActionCtx): Promise<{ url: string }> => {
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
  handler: async (ctx: MutationCtx, args) => {
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_venue', (q) => q.eq('venueId', args.venueId))
      .unique();
    if (!subscription) throw new Error('Subscription not found');

    const venue = await ctx.db.get(args.venueId);
    if (!venue) throw new Error('Venue not found');

    const now = Date.now();
    const currentPeriodEnd = periodEndForPackage(args.packageRef, now);
    await ctx.db.patch(subscription._id, {
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
    await ctx.db.patch(venue._id, {
      subscriptionStatus: 'active',
      subscriptionPlatform: args.platform,
    });

    const updated = await ctx.db.get(subscription._id);
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
  handler: async (ctx: MutationCtx, args) => {
    const event = args.event;
    const object = event?.data?.object ?? {};
    const venueId = object?.metadata?.venueId ?? object?.client_reference_id;
    let subscription: Doc<'subscriptions'> | null = null;
    if (venueId) {
      subscription = await ctx.db
        .query('subscriptions')
        .withIndex('by_venue', (q) => q.eq('venueId', venueId))
        .unique();
    }
    if (!subscription && object?.id && String(event.type ?? '').startsWith('customer.subscription.')) {
      subscription = await ctx.db
        .query('subscriptions')
        .withIndex('by_external_id', (q) => q.eq('externalSubscriptionId', object.id))
        .unique();
    }
    if (!subscription) return { status: 'skipped' };

    const externalEventId = event.id ?? `${event.type}:${Date.now()}`;
    const duplicate = await ctx.db
      .query('subscriptionEvents')
      .withIndex('by_source_external_id', (q) => q.eq('source', 'stripe').eq('externalEventId', externalEventId))
      .unique();
    if (duplicate) return { status: 'duplicate' };

    await ctx.db.insert('subscriptionEvents', {
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
      patch.externalCustomerId = object.customer ?? subscription.externalCustomerId;
      patch.externalSubscriptionId = object.subscription ?? subscription.externalSubscriptionId;
      const planId = object.metadata?.planId;
      if (planId && planId in getBillingPlans()) {
        const plan = planById(planId);
        patch.planId = planId;
        patch.priceCents = plan.priceCents;
      }
    }
    if (String(event.type ?? '').startsWith('customer.subscription.')) {
      const planId = object.metadata?.planId ?? planByStripePrice(object.items?.data?.[0]?.price?.id);
      if (planId) {
        const plan = planById(planId);
        patch.planId = planId;
        patch.priceCents = plan.priceCents;
      }
      patch.status = mapStripeStatus(object.status);
      patch.externalCustomerId = object.customer ?? subscription.externalCustomerId;
      patch.externalSubscriptionId = object.id ?? subscription.externalSubscriptionId;
      patch.currentPeriodStart = stripeMs(object.current_period_start);
      patch.currentPeriodEnd = stripeMs(object.current_period_end);
      patch.cancelAtPeriodEnd = Boolean(object.cancel_at_period_end);
      patch.cancelledAt = stripeMs(object.canceled_at);
    }
    const invoiceStatusPatch: Record<string, unknown> = {};
    if (event.type === 'invoice.paid') {
      invoiceStatusPatch.status = 'active';
      invoiceStatusPatch.externalCustomerId = object.customer ?? subscription.externalCustomerId;
      invoiceStatusPatch.externalSubscriptionId = object.subscription ?? subscription.externalSubscriptionId;
      invoiceStatusPatch.currentPeriodStart = stripeMs(object.period_start);
      invoiceStatusPatch.currentPeriodEnd = stripeMs(object.period_end);
      invoiceStatusPatch.cancelAtPeriodEnd = false;
      invoiceStatusPatch.cancelledAt = null;
    }
    if (event.type === 'invoice.payment_failed') {
      invoiceStatusPatch.status = 'past_due';
      invoiceStatusPatch.externalCustomerId = object.customer ?? subscription.externalCustomerId;
      invoiceStatusPatch.externalSubscriptionId = object.subscription ?? subscription.externalSubscriptionId;
      invoiceStatusPatch.currentPeriodStart = stripeMs(object.period_start);
      invoiceStatusPatch.currentPeriodEnd = stripeMs(object.period_end);
    }

    await ctx.db.patch(subscription._id, { ...patch, ...invoiceStatusPatch });
    const updated = await ctx.db.get(subscription._id);
    if (updated) {
      await ctx.db.patch(updated.venueId, {
        subscriptionStatus: updated.status,
        subscriptionPlatform: updated.platform,
      });
    }

    if ((event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') && object.id) {
      const existingInvoice = await ctx.db
        .query('invoices')
        .withIndex('by_stripe_id', (q) => q.eq('stripeInvoiceId', object.id))
        .unique();
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
      if (existingInvoice) await ctx.db.patch(existingInvoice._id, invoicePayload);
      else await ctx.db.insert('invoices', invoicePayload);
    }
    return { status: 'processed' };
  },
});

// Subscription status is written ONLY by verified billing-provider paths
// (reconcilePaidSubscription, handleStripeWebhook, handleRevenueCatEvent — all
// internalMutations). There is intentionally no client-callable mutation to set
// it: a previous syncVenueSubscription let an authenticated owner downgrade
// their own venue (cancelled/past_due/expired/paused) without the provider,
// corrupting access state. Cancellation flows through the Stripe billing portal
// (createStripeBillingPortalSession); the resulting status returns via webhook.

// RevenueCat webhook handler (called from convex/http.ts). The RevenueCat
// app_user_id is the venue id, so we map the event straight onto that venue.
export const handleRevenueCatEvent = internalMutation({
  args: { appUserId: v.string(), status: subscriptionStatusValue },
  returns: v.null(),
  handler: async (ctx: MutationCtx, args) => {
    // app_user_id is a venue id string; ignore anything that isn't a real venue.
    const venue = await ctx.db.get(args.appUserId as Id<'venues'>).catch(() => null);
    if (!venue || !('name' in venue)) return null;
    await ctx.db.patch(venue._id, {
      subscriptionStatus: args.status,
      subscriptionPlatform: 'apple',
    });
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_venue', (q) => q.eq('venueId', venue._id))
      .unique();
    if (subscription) {
      await ctx.db.patch(subscription._id, { status: args.status, platform: 'apple', updatedAt: Date.now() });
    }
    return null;
  },
});
