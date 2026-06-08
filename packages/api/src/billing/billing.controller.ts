import { Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionStatus } from '@prisma/client';
import { Public } from '../auth/public.decorator';
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

@Controller('v1/billing')
export class BillingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('revenuecat/webhook')
  async revenueCatWebhook(@Headers('authorization') authorization: string | undefined, @Body() body: RevenueCatWebhookBody) {
    const expectedSecret = this.config.get<string>('REVENUECAT_WEBHOOK_SECRET');
    if (expectedSecret) {
      const token = authorization?.replace(/^Bearer\s+/i, '').trim();
      if (token !== expectedSecret) {
        throw new UnauthorizedException('Invalid RevenueCat webhook secret');
      }
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
      payload: body,
    });

    return { ok: true };
  }

  async applyAppleSubscription(input: {
    venueId: string;
    status: SubscriptionStatus;
    planId: string;
    externalSubscriptionId?: string | null;
    externalCustomerId?: string | null;
    currentPeriodStart?: Date | null;
    currentPeriodEnd?: Date | null;
    cancelAtPeriodEnd?: boolean;
    eventId?: string;
    eventType?: string;
    payload?: unknown;
  }) {
    const venue = await this.prisma.venue.findUnique({ where: { id: input.venueId } });
    if (!venue) {
      return null;
    }

    const now = new Date();
    const existing = await this.prisma.subscription.findFirst({ where: { venueId: input.venueId } });
    await this.prisma.$transaction([
      this.prisma.venue.update({
        where: { id: input.venueId },
        data: {
          subscriptionStatus: input.status,
          subscriptionPlatform: 'apple',
        },
      }),
      existing
        ? this.prisma.subscription.update({
            where: { id: existing.id },
            data: {
              status: input.status,
              platform: 'apple',
              planId: input.planId,
              currentPeriodStart: input.currentPeriodStart ?? existing.currentPeriodStart,
              currentPeriodEnd: input.currentPeriodEnd ?? existing.currentPeriodEnd,
              cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
              cancelledAt: input.status === 'cancelled' ? now : input.status === 'active' ? null : existing.cancelledAt,
              externalSubscriptionId: input.externalSubscriptionId ?? existing.externalSubscriptionId,
              externalCustomerId: input.externalCustomerId ?? existing.externalCustomerId,
              lastRevenueCatEventAt: now,
            },
          })
        : this.prisma.subscription.create({
            data: {
              venueId: input.venueId,
              status: input.status,
              platform: 'apple',
              planId: input.planId,
              priceCents: 0,
              currency: 'USD',
              trialStartedAt: now,
              trialEndsAt: now,
              currentPeriodStart: input.currentPeriodStart ?? now,
              currentPeriodEnd: input.currentPeriodEnd,
              cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
              cancelledAt: input.status === 'cancelled' ? now : null,
              externalSubscriptionId: input.externalSubscriptionId ?? null,
              externalCustomerId: input.externalCustomerId ?? null,
              lastRevenueCatEventAt: now,
            },
          }),
      ...(input.eventId && input.eventType
        ? [
            this.prisma.subscriptionEvent.create({
              data: {
                venueId: input.venueId,
                source: 'revenuecat',
                externalEventId: input.eventId,
                eventType: input.eventType,
                payload: (input.payload ?? {}) as never,
                processedAt: now,
                status: 'processed',
              },
            }),
          ]
        : []),
    ]);

    return { status: input.status };
  }
}
