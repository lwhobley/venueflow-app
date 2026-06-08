import { Body, Controller, Headers, HttpException, HttpStatus, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionStatus } from '@prisma/client';
import type { Request } from 'express';
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
const WEBHOOK_RATE_LIMIT_WINDOW_MS = 60_000;
const WEBHOOK_RATE_LIMIT_MAX = 120;
const webhookAttempts = new Map<string, { count: number; resetAt: number }>();

@Controller('v1/billing')
export class BillingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('revenuecat/webhook')
  async revenueCatWebhook(@Req() request: Request, @Headers('authorization') authorization: string | undefined, @Body() body: RevenueCatWebhookBody) {
    assertWithinRateLimit(`revenuecat:${getClientIp(request)}`, WEBHOOK_RATE_LIMIT_MAX, WEBHOOK_RATE_LIMIT_WINDOW_MS);
    const expectedSecret = this.config.get<string>('REVENUECAT_WEBHOOK_SECRET');
    if (!expectedSecret && this.config.get<string>('NODE_ENV') === 'production') {
      throw new UnauthorizedException('RevenueCat webhook secret is not configured');
    }
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
      eventAt: new Date(event.event_timestamp_ms ?? event.purchased_at_ms ?? Date.now()),
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
    eventAt?: Date;
    payload?: unknown;
  }) {
    const now = new Date();
    const eventAt = input.eventAt ?? now;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const venue = await tx.venue.findUnique({ where: { id: input.venueId } });
        if (!venue) {
          return null;
        }

        const existing = await tx.subscription.findFirst({ where: { venueId: input.venueId } });
        const isStale = Boolean(existing?.lastRevenueCatEventAt && existing.lastRevenueCatEventAt > eventAt);
        if (isStale) {
          if (input.eventId && input.eventType) {
            await tx.subscriptionEvent.create({
              data: {
                venueId: input.venueId,
                source: 'revenuecat',
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
          data: {
            subscriptionStatus: input.status,
            subscriptionPlatform: 'apple',
          },
        });
        if (existing) {
          await tx.subscription.update({
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
              lastRevenueCatEventAt: eventAt,
            },
          });
        } else {
          await tx.subscription.create({
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
              lastRevenueCatEventAt: eventAt,
            },
          });
        }
        if (input.eventId && input.eventType) {
          await tx.subscriptionEvent.create({
            data: {
              venueId: input.venueId,
              source: 'revenuecat',
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

function getClientIp(request: Request) {
  const forwarded = request.headers['x-forwarded-for'];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return firstForwarded?.trim() || request.ip || 'unknown';
}

function assertWithinRateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const current = webhookAttempts.get(key);
  if (!current || current.resetAt <= now) {
    webhookAttempts.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (current.count >= max) {
    throw new HttpException('Too many webhook requests.', HttpStatus.TOO_MANY_REQUESTS);
  }
  current.count += 1;
}
