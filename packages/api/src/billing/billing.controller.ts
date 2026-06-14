import { Body, Controller, Headers, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionStatus } from '@prisma/client';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { getClientIp } from '../common/http';
import { assertWithinSharedRateLimit } from '../common/rate-limit';
import { verifyStripeSignature } from '../common/webhook-auth';
import { PrismaService } from '../prisma/prisma.service';

type RevenueCatWebhookBody = {
  event?: {
    id?: string;
    type?: string;
    app_user_id?: string;
    product_id?: string;
    entitlement_ids?: string[];
    transaction_id?: string;
    original_transaction_id?: string;
    expiration_at_ms?: number;
    purchased_at_ms?: number;
    event_timestamp_ms?: number;
  };
};

const ACTIVE_REVENUECAT_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'PRODUCT_CHANGE',
  'NON_RENEWING_PURCHASE',
]);

const INACTIVE_REVENUECAT_EVENTS: Record<string, SubscriptionStatus> = {
  BILLING_ISSUE: 'past_due',
  EXPIRATION: 'expired',
  SUBSCRIPTION_PAUSED: 'paused',
};
const WEBHOOK_RATE_LIMIT_WINDOW_MS = 60_000;
const WEBHOOK_RATE_LIMIT_MAX = 120;

type StripeEvent = {
  id?: string;
  type?: string;
  created?: number;
  data?: { object?: any };
};

// Stripe subscription.status -> our SubscriptionStatus.
const STRIPE_STATUS_MAP: Record<string, SubscriptionStatus> = {
  active: 'active',
  trialing: 'trialing',
  past_due: 'past_due',
  unpaid: 'past_due',
  canceled: 'cancelled',
  paused: 'paused',
  incomplete: 'past_due',
  incomplete_expired: 'expired',
};

type SubscriptionInput = {
  venueId: string;
  status: SubscriptionStatus;
  planId: string;
  priceCents?: number | null;
  currency?: string | null;
  externalSubscriptionId?: string | null;
  externalCustomerId?: string | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  eventId?: string;
  eventType?: string;
  eventAt?: Date;
  payload?: unknown;
};

function unixToDate(seconds: number | null | undefined): Date | null {
  return typeof seconds === 'number' && Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
}

@Controller('v1/billing')
export class BillingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('revenuecat/webhook')
  async revenueCatWebhook(@Req() request: Request, @Headers('authorization') authorization: string | undefined, @Body() body: RevenueCatWebhookBody) {
    await assertWithinSharedRateLimit(this.prisma, `revenuecat:${getClientIp(request)}`, WEBHOOK_RATE_LIMIT_MAX, WEBHOOK_RATE_LIMIT_WINDOW_MS, 'Too many webhook requests.');
    // Fail closed: the webhook is @Public(), so without a configured secret
    // anyone could forge subscription state for any venue. Always require it.
    const expectedSecret = this.config.get<string>('REVENUECAT_WEBHOOK_SECRET');
    if (!expectedSecret) {
      throw new UnauthorizedException('RevenueCat webhook secret is not configured');
    }
    const token = authorization?.replace(/^Bearer\s+/i, '').trim();
    if (token !== expectedSecret) {
      throw new UnauthorizedException('Invalid RevenueCat webhook secret');
    }

    const event = body.event;
    const venueId = event?.app_user_id;
    if (!event?.type || !venueId) {
      return { ok: true, ignored: true };
    }

    const expiresInFuture = event.expiration_at_ms ? event.expiration_at_ms > Date.now() : false;
    const status = event.type === 'CANCELLATION' && expiresInFuture
      ? 'active'
      : event.type === 'CANCELLATION'
        ? 'cancelled'
        : ACTIVE_REVENUECAT_EVENTS.has(event.type)
      ? 'active'
      : INACTIVE_REVENUECAT_EVENTS[event.type];
    if (!status) {
      return { ok: true, ignored: true };
    }

    await this.applyAppleSubscription({
      venueId,
      status,
      planId: event.product_id ?? 'apple_subscription',
      externalSubscriptionId: event.original_transaction_id ?? event.transaction_id ?? null,
      externalCustomerId: venueId,
      currentPeriodStart: event.purchased_at_ms ? new Date(event.purchased_at_ms) : null,
      currentPeriodEnd: event.expiration_at_ms ? new Date(event.expiration_at_ms) : null,
      cancelAtPeriodEnd: event.type === 'CANCELLATION' && expiresInFuture,
      eventId: event.id ?? `${event.type}:${venueId}:${event.event_timestamp_ms ?? Date.now()}`,
      eventType: event.type,
      eventAt: new Date(event.event_timestamp_ms ?? event.purchased_at_ms ?? Date.now()),
      payload: body,
    });

    return { ok: true };
  }

  @Public()
  @Post('stripe/webhook')
  async stripeWebhook(
    @Req() request: Request,
    @Headers('stripe-signature') signature: string | undefined,
    @Body() body: StripeEvent,
  ) {
    await assertWithinSharedRateLimit(this.prisma, `stripe:${getClientIp(request)}`, WEBHOOK_RATE_LIMIT_MAX, WEBHOOK_RATE_LIMIT_WINDOW_MS, 'Too many webhook requests.');
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret) {
      throw new UnauthorizedException('Stripe webhook secret is not configured');
    }
    const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;
    if (!verifyStripeSignature(rawBody, signature, secret)) {
      throw new UnauthorizedException('Invalid Stripe signature');
    }

    const event = body;
    const object = event.data?.object ?? {};
    const eventAt = unixToDate(event.created) ?? new Date();

    if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const venueId = await this.resolveStripeVenueId(object);
      if (!venueId) return { ok: true, ignored: true };
      const status =
        event.type === 'customer.subscription.deleted'
          ? ('cancelled' as SubscriptionStatus)
          : STRIPE_STATUS_MAP[object.status] ?? null;
      if (!status) return { ok: true, ignored: true };
      const price = object.items?.data?.[0]?.price ?? {};
      await this.applyStripeSubscription({
        venueId,
        status,
        planId: typeof price.id === 'string' ? price.id : 'stripe_subscription',
        priceCents: typeof price.unit_amount === 'number' ? price.unit_amount : null,
        currency: typeof price.currency === 'string' ? price.currency.toUpperCase() : null,
        externalSubscriptionId: typeof object.id === 'string' ? object.id : null,
        externalCustomerId: typeof object.customer === 'string' ? object.customer : null,
        currentPeriodStart: unixToDate(object.current_period_start),
        currentPeriodEnd: unixToDate(object.current_period_end),
        cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
        eventId: event.id,
        eventType: event.type,
        eventAt,
        payload: body,
      });
      return { ok: true };
    }

    if (event.type === 'invoice.payment_succeeded' || event.type === 'invoice.payment_failed') {
      await this.recordStripeInvoice(object, event, eventAt);
      return { ok: true };
    }

    if (event.type === 'charge.refunded') {
      await this.recordStripeRefund(object, event, eventAt);
      return { ok: true };
    }

    return { ok: true, ignored: true };
  }

  private async resolveStripeVenueId(object: any): Promise<string | null> {
    const metaVenueId = object?.metadata?.venueId;
    if (typeof metaVenueId === 'string' && metaVenueId) {
      const venue = await this.prisma.venue.findUnique({ where: { id: metaVenueId }, select: { id: true } });
      if (venue) return venue.id;
    }
    const subId = typeof object?.id === 'string' ? object.id : null;
    const customerId = typeof object?.customer === 'string' ? object.customer : null;
    if (!subId && !customerId) return null;
    const existing = await this.prisma.subscription.findFirst({
      where: {
        OR: [
          ...(subId ? [{ externalSubscriptionId: subId }] : []),
          ...(customerId ? [{ externalCustomerId: customerId }] : []),
        ],
      },
      select: { venueId: true },
    });
    return existing?.venueId ?? null;
  }

  private async recordStripeInvoice(invoice: any, event: StripeEvent, eventAt: Date) {
    const stripeInvoiceId = typeof invoice?.id === 'string' ? invoice.id : null;
    if (!stripeInvoiceId) return;
    const subId = typeof invoice?.subscription === 'string' ? invoice.subscription : null;
    const customerId = typeof invoice?.customer === 'string' ? invoice.customer : null;
    const metaVenueId = typeof invoice?.metadata?.venueId === 'string' ? invoice.metadata.venueId : null;
    const sub =
      subId || customerId
        ? await this.prisma.subscription.findFirst({
            where: {
              OR: [
                ...(subId ? [{ externalSubscriptionId: subId }] : []),
                ...(customerId ? [{ externalCustomerId: customerId }] : []),
              ],
            },
            select: { venueId: true },
          })
        : null;
    const venueId = metaVenueId ?? sub?.venueId ?? null;
    if (!venueId) return;

    // Per-event idempotency: skip if this exact event was already processed.
    try {
      await this.prisma.subscriptionEvent.create({
        data: {
          venueId,
          source: 'stripe',
          externalEventId: event.id ?? `inv:${stripeInvoiceId}:${event.type}`,
          eventType: event.type ?? 'invoice',
          payload: event as never,
          processedAt: new Date(),
          status: 'processed',
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') return;
      throw error;
    }

    const data = {
      venueId,
      amountCents: Math.round(Number(invoice.amount_paid ?? invoice.amount_due ?? 0)) || 0,
      currency: String(invoice.currency ?? 'usd').toUpperCase(),
      status: String(invoice.status ?? 'open'),
      invoiceUrl: typeof invoice.invoice_pdf === 'string' ? invoice.invoice_pdf : null,
      hostedInvoiceUrl: typeof invoice.hosted_invoice_url === 'string' ? invoice.hosted_invoice_url : null,
      periodStart: unixToDate(invoice.period_start) ?? eventAt,
      periodEnd: unixToDate(invoice.period_end) ?? eventAt,
      paidAt: unixToDate(invoice.status_transitions?.paid_at),
    };
    // stripeInvoiceId is unique, so concurrent re-deliveries upsert one row.
    await this.prisma.invoice.upsert({
      where: { stripeInvoiceId },
      create: { stripeInvoiceId, ...data },
      update: data,
    });
  }

  private async recordStripeRefund(charge: any, event: StripeEvent, _eventAt: Date) {
    const stripeInvoiceId = typeof charge?.invoice === 'string' ? charge.invoice : null;
    if (!stripeInvoiceId) return;

    const invoice = await this.prisma.invoice.findUnique({ where: { stripeInvoiceId } });
    if (!invoice) return;

    try {
      await this.prisma.subscriptionEvent.create({
        data: {
          venueId: invoice.venueId,
          source: 'stripe',
          externalEventId: event.id ?? `refund:${stripeInvoiceId}`,
          eventType: event.type ?? 'charge.refunded',
          payload: event as never,
          processedAt: new Date(),
          status: 'processed',
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') return;
      throw error;
    }

    await this.prisma.invoice.update({
      where: { stripeInvoiceId },
      data: { status: charge.refunded ? 'refunded' : 'partially_refunded' },
    });
  }

  async applyStripeSubscription(input: SubscriptionInput) {
    return this.applySubscription({ ...input, platform: 'stripe', source: 'stripe', staleField: 'lastStripeEventAt' });
  }

  async applyAppleSubscription(input: SubscriptionInput) {
    return this.applySubscription({ ...input, platform: 'apple', source: 'revenuecat', staleField: 'lastRevenueCatEventAt' });
  }

  private async applySubscription(input: SubscriptionInput & {
    platform: 'stripe' | 'apple';
    source: string;
    staleField: 'lastStripeEventAt' | 'lastRevenueCatEventAt';
  }) {
    const now = new Date();
    const eventAt = input.eventAt ?? now;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const venue = await tx.venue.findUnique({ where: { id: input.venueId } });
        if (!venue) return null;

        const existing = await tx.subscription.findFirst({ where: { venueId: input.venueId } });
        const lastEventAt = existing?.[input.staleField];
        const isStale = Boolean(lastEventAt && lastEventAt > eventAt);
        if (isStale) {
          if (input.eventId && input.eventType) {
            await tx.subscriptionEvent.create({
              data: {
                venueId: input.venueId,
                source: input.source,
                externalEventId: input.eventId,
                eventType: input.eventType,
                payload: (input.payload ?? {}) as never,
                processedAt: now,
                status: 'ignored_stale',
              },
            });
          }
          return { status: existing!.status, ignored: true };
        }

        await tx.venue.update({
          where: { id: input.venueId },
          data: { subscriptionStatus: input.status, subscriptionPlatform: input.platform },
        });
        const eventTimestamp = { [input.staleField]: eventAt };
        if (existing) {
          await tx.subscription.update({
            where: { id: existing.id },
            data: {
              status: input.status,
              platform: input.platform,
              planId: input.planId,
              priceCents: input.priceCents ?? existing.priceCents,
              currency: input.currency ?? existing.currency,
              currentPeriodStart: input.currentPeriodStart ?? existing.currentPeriodStart,
              currentPeriodEnd: input.currentPeriodEnd ?? existing.currentPeriodEnd,
              cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
              cancelledAt: input.status === 'cancelled' ? now : input.status === 'active' ? null : existing.cancelledAt,
              externalSubscriptionId: input.externalSubscriptionId ?? existing.externalSubscriptionId,
              externalCustomerId: input.externalCustomerId ?? existing.externalCustomerId,
              ...eventTimestamp,
            },
          });
        } else {
          await tx.subscription.create({
            data: {
              venueId: input.venueId,
              status: input.status,
              platform: input.platform,
              planId: input.planId,
              priceCents: input.priceCents ?? 0,
              currency: input.currency ?? 'USD',
              trialStartedAt: now,
              trialEndsAt: now,
              currentPeriodStart: input.currentPeriodStart ?? now,
              currentPeriodEnd: input.currentPeriodEnd,
              cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
              cancelledAt: input.status === 'cancelled' ? now : null,
              externalSubscriptionId: input.externalSubscriptionId ?? null,
              externalCustomerId: input.externalCustomerId ?? null,
              ...eventTimestamp,
            },
          });
        }
        if (input.eventId && input.eventType) {
          await tx.subscriptionEvent.create({
            data: {
              venueId: input.venueId,
              source: input.source,
              externalEventId: input.eventId,
              eventType: input.eventType,
              payload: (input.payload ?? {}) as never,
              processedAt: now,
              status: 'processed',
            },
          });
        }
        return { status: input.status };
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        return { ok: true, duplicate: true };
      }
      throw error;
    }
  }
}

