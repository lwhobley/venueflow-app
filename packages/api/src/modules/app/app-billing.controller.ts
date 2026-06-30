import { BadRequestException, Body, Controller, Get, Logger, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionStatus } from '@prisma/client';
import { IsOptional, IsString } from 'class-validator';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../auth/auth.guard';
import { assertWithinSharedRateLimit } from '../../common/rate-limit';
import { stripeRequest } from '../../billing/stripe-api';
import { PrismaService } from '../../prisma/prisma.service';
import { toMs } from './app-mappers';
import { ProfileService } from './profile.service';

// Idempotency key for the auto-created subscription price, so repeated lookups
// reuse one price instead of creating duplicates.
const STRIPE_PRICE_LOOKUP_KEY = 'venue_wrangler_monthly';
const STRIPE_PLAN_AMOUNT_CENTS = 9999;

class AppleSubscriptionSyncDto {
  @IsString()
  productId!: string;

  @IsString()
  @IsOptional()
  entitlementId?: string;
}

// Billing read + Apple/RevenueCat entitlement sync for /v1/app/billing*.
// Split out of AppController; routes and response shapes are unchanged.
@Controller('v1/app')
export class AppBillingController {
  private readonly logger = new Logger(AppBillingController.name);
  // Resolved Stripe price id is stable for the process; cache after first lookup.
  private cachedStripePriceId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly profiles: ProfileService,
  ) {}

  @UseGuards(AuthGuard)
  @Get('billing')
  async getMyVenueBilling(@CurrentUser() user: AuthUser) {
    const profile = await this.profiles.getProfile(user);
    if (!profile?.venueId) return null;
    const subscription = await this.prisma.subscription.findFirst({ where: { venueId: profile.venueId } });
    if (!subscription) return null;
    return {
      venueId: subscription.venueId,
      status: subscription.status,
      platform: subscription.platform,
      trialStartedAt: subscription.trialStartedAt.getTime(),
      trialEndsAt: subscription.trialEndsAt.getTime(),
      currentPeriodStart: toMs(subscription.currentPeriodStart),
      currentPeriodEnd: toMs(subscription.currentPeriodEnd),
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      cancelledAt: toMs(subscription.cancelledAt),
      planId: subscription.planId,
      priceCents: subscription.priceCents,
      currency: subscription.currency,
    };
  }

  // Web subscribes through Stripe (Apple IAP only exists in the iOS app). The
  // session stamps venueId into metadata so the existing Stripe webhook
  // (BillingController) flips the same venue.subscriptionStatus to active —
  // which the iOS app then reads, so paid access is shared across platforms.
  @UseGuards(AuthGuard)
  @Post('billing/stripe/checkout')
  async createStripeCheckout(@CurrentUser() user: AuthUser) {
    await assertWithinSharedRateLimit(this.prisma, `stripe-checkout:${user.sub}`, 10, 60_000);
    const profile = await this.profiles.requireBillingProfile(user);
    const secret = this.requireStripeSecret();
    const priceId = await this.resolveStripePriceId(secret);
    const base = this.webBaseUrl();
    const session = await stripeRequest<{ url?: string }>(secret, 'POST', '/checkout/sessions', {
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${base}/app/billing?status=success`,
      cancel_url: `${base}/app/billing?status=cancelled`,
      client_reference_id: profile.venueId,
      allow_promotion_codes: true,
      metadata: { venueId: profile.venueId },
      subscription_data: { metadata: { venueId: profile.venueId } },
    });
    if (!session.url) {
      throw new ServiceUnavailableException('Stripe did not return a checkout URL.');
    }
    return { url: session.url };
  }

  // Stripe-billed venues manage/cancel through the Stripe customer portal (web
  // has no Apple subscriptions page). Apple-billed venues store the venueId as
  // their externalCustomerId, so we gate on platform === 'stripe'.
  @UseGuards(AuthGuard)
  @Post('billing/stripe/portal')
  async createStripePortal(@CurrentUser() user: AuthUser) {
    await assertWithinSharedRateLimit(this.prisma, `stripe-portal:${user.sub}`, 10, 60_000);
    const profile = await this.profiles.requireBillingProfile(user);
    const secret = this.requireStripeSecret();
    const subscription = await this.prisma.subscription.findFirst({
      where: { venueId: profile.venueId! },
      select: { externalCustomerId: true, platform: true },
    });
    if (subscription?.platform !== 'stripe' || !subscription.externalCustomerId) {
      throw new BadRequestException('No Stripe subscription for this venue yet.');
    }
    const session = await stripeRequest<{ url?: string }>(secret, 'POST', '/billing_portal/sessions', {
      customer: subscription.externalCustomerId,
      return_url: `${this.webBaseUrl()}/app/billing`,
    });
    if (!session.url) {
      throw new ServiceUnavailableException('Stripe did not return a portal URL.');
    }
    return { url: session.url };
  }

  private requireStripeSecret(): string {
    const secret = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!secret) {
      throw new ServiceUnavailableException('Stripe is not configured.');
    }
    return secret;
  }

  private webBaseUrl(): string {
    return (this.config.get<string>('APP_WEB_URL') ?? 'https://venuewrangler.com').replace(/\/+$/, '');
  }

  // Prefer an explicitly configured price; otherwise reuse-or-create one keyed
  // by a stable lookup_key so we never accumulate duplicate prices.
  private async resolveStripePriceId(secret: string): Promise<string> {
    const configured = this.config.get<string>('STRIPE_PRICE_ID');
    if (configured) return configured;
    if (this.cachedStripePriceId) return this.cachedStripePriceId;

    const found = await stripeRequest<{ data?: { id: string }[] }>(secret, 'GET', '/prices', {
      lookup_keys: [STRIPE_PRICE_LOOKUP_KEY],
      active: true,
      limit: 1,
    });
    const existing = found.data?.[0]?.id;
    if (existing) {
      this.cachedStripePriceId = existing;
      return existing;
    }

    const product = await stripeRequest<{ id: string }>(secret, 'POST', '/products', { name: 'Venue Wrangler' });
    try {
      const price = await stripeRequest<{ id: string }>(secret, 'POST', '/prices', {
        product: product.id,
        unit_amount: STRIPE_PLAN_AMOUNT_CENTS,
        currency: 'usd',
        recurring: { interval: 'month' },
        lookup_key: STRIPE_PRICE_LOOKUP_KEY,
      });
      this.cachedStripePriceId = price.id;
      return price.id;
    } catch (error) {
      // A concurrent request may have claimed the lookup_key first; re-fetch it.
      this.logger.warn(`Stripe price creation failed, attempting re-fetch: ${error instanceof Error ? error.message : String(error)}`);
      const retry = await stripeRequest<{ data?: { id: string }[] }>(secret, 'GET', '/prices', {
        lookup_keys: [STRIPE_PRICE_LOOKUP_KEY],
        active: true,
        limit: 1,
      });
      const claimed = retry.data?.[0]?.id;
      if (claimed) {
        this.cachedStripePriceId = claimed;
        return claimed;
      }
      throw error;
    }
  }

  @UseGuards(AuthGuard)
  @Post('billing/apple/sync')
  async syncAppleSubscription(@CurrentUser() user: AuthUser, @Body() body: AppleSubscriptionSyncDto) {
    await assertWithinSharedRateLimit(this.prisma, `apple-sync:${user.sub}`, 10, 60_000);

    const profile = await this.profiles.requireBillingProfile(user);
    const verified = await this.verifyRevenueCatEntitlement(profile.venueId!, body.productId, body.entitlementId);
    if (!verified) {
      return this.getMyVenueBilling(user);
    }
    const status: SubscriptionStatus = 'active';
    const now = new Date();
    const existing = await this.prisma.subscription.findFirst({ where: { venueId: profile.venueId! } });
    await this.prisma.$transaction([
      this.prisma.venue.update({
        where: { id: profile.venueId! },
        data: {
          subscriptionStatus: status,
          subscriptionPlatform: 'apple',
        },
      }),
      existing
        ? this.prisma.subscription.update({
            where: { id: existing.id },
            data: {
              status,
              platform: 'apple',
              planId: body.productId,
              currentPeriodStart: verified.currentPeriodStart ?? existing.currentPeriodStart ?? now,
              currentPeriodEnd: verified.currentPeriodEnd ?? existing.currentPeriodEnd,
              cancelAtPeriodEnd: false,
              cancelledAt: null,
              externalCustomerId: profile.venueId!,
              lastRevenueCatEventAt: now,
            },
          })
        : this.prisma.subscription.create({
            data: {
              venueId: profile.venueId!,
              status,
              platform: 'apple',
              planId: body.productId,
              priceCents: 0,
              currency: 'USD',
              trialStartedAt: now,
              trialEndsAt: now,
              currentPeriodStart: verified.currentPeriodStart ?? now,
              currentPeriodEnd: verified.currentPeriodEnd,
              cancelAtPeriodEnd: false,
              externalCustomerId: profile.venueId!,
              lastRevenueCatEventAt: now,
            },
          }),
    ]);

    return this.getMyVenueBilling(user);
  }

  private async verifyRevenueCatEntitlement(venueId: string, productId: string, entitlementId?: string) {
    const apiKey = this.config.get<string>('REVENUECAT_API_KEY') ?? this.config.get<string>('REVENUECAT_SECRET_API_KEY');
    if (!apiKey) {
      return null;
    }

    const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(venueId)}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });
    const json: any = await response.json().catch(() => null);
    if (!response.ok) {
      this.logger.warn(`RevenueCat verification failed for venue ${venueId}: ${json?.message ?? response.statusText}`);
      throw new BadRequestException('Could not verify RevenueCat subscription.');
    }

    const subscriber = json?.subscriber ?? {};
    const entitlements = subscriber.entitlements ?? {};
    const subscriptions = subscriber.subscriptions ?? {};
    const matchingEntitlement = entitlementId
      ? entitlements[entitlementId]
      : Object.values(entitlements).find((entitlement: any) => entitlement?.product_identifier === productId);
    const matchingSubscription = subscriptions[productId];
    const expiresAt = parseRevenueCatDate(matchingEntitlement?.expires_date ?? matchingSubscription?.expires_date);
    const purchasedAt = parseRevenueCatDate(matchingEntitlement?.purchase_date ?? matchingSubscription?.purchase_date);
    const isActive = Boolean(matchingEntitlement || matchingSubscription) && (!expiresAt || expiresAt.getTime() > Date.now());
    if (!isActive) {
      throw new BadRequestException('No active RevenueCat entitlement found for this Apple subscription.');
    }

    return { currentPeriodStart: purchasedAt, currentPeriodEnd: expiresAt };
  }
}

function parseRevenueCatDate(value: unknown) {
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
