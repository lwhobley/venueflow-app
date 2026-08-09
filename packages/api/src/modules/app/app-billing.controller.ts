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
const STRIPE_MULTI_PRICE_LOOKUP_KEY = 'venue_wrangler_multi_venue_399';
const STRIPE_PLAN_AMOUNT_CENTS = 9999;
const STRIPE_MULTI_AMOUNT_CENTS = 39900;

class CreateStripeCheckoutDto {
  @IsString()
  @IsOptional()
  plan?: 'single' | 'multi_venue';
}

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
  // Resolved Stripe price ids are stable for the process; cache after first lookup.
  private cachedStripePriceId: string | null = null;
  private cachedStripeMultiVenuePriceId: string | null = null;

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
      trialStartedAt: toMs(subscription.trialStartedAt),
      trialEndsAt: toMs(subscription.trialEndsAt),
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
  async createStripeCheckout(@CurrentUser() user: AuthUser, @Body() body?: CreateStripeCheckoutDto) {
    await assertWithinSharedRateLimit(this.prisma, `stripe-checkout:${user.sub}`, 10, 60_000);
    const profile = await this.profiles.requireBillingProfile(user);
    const secret = this.requireStripeSecret();
    const existing = await this.prisma.subscription.findFirst({
      where: { venueId: profile.venueId! },
      select: { status: true, platform: true, externalCustomerId: true },
    });
    if (existing?.platform === 'stripe' && (existing.status === 'active' || existing.status === 'trialing')) {
      throw new BadRequestException('This venue already has an active Stripe subscription.');
    }
    const isMulti = body?.plan === 'multi_venue';
    const priceId = await this.resolveStripePriceId(secret, isMulti ? 'multi_venue' : 'single');
    const base = this.webBaseUrl();
    const idempotencyKey = `checkout:${profile.venueId}:${isMulti ? 'multi' : 'single'}:${Math.floor(Date.now() / (10 * 60 * 1000))}`;
    const session = await stripeRequest<{ url?: string }>(secret, 'POST', '/checkout/sessions', {
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${base}/app/billing?status=success`,
      cancel_url: `${base}/app/billing?status=cancelled`,
      client_reference_id: profile.venueId,
      ...(existing?.externalCustomerId ? { customer: existing.externalCustomerId } : {}),
      allow_promotion_codes: true,
      metadata: { venueId: profile.venueId, planType: isMulti ? 'multi_venue' : 'single' },
      subscription_data: { metadata: { venueId: profile.venueId, planType: isMulti ? 'multi_venue' : 'single' } },
    }, idempotencyKey);
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
    const subscription = await this.prisma.subscription.findFirst({
      where: { venueId: profile.venueId! },
      select: { platform: true, externalCustomerId: true },
    });
    if (subscription?.platform !== 'stripe' || !subscription.externalCustomerId) {
      throw new BadRequestException('No Stripe subscription for this venue yet.');
    }
    const secret = this.requireStripeSecret();
    const base = this.webBaseUrl();
    const session = await stripeRequest<{ url?: string }>(secret, 'POST', '/billing_portal/sessions', {
      customer: subscription.externalCustomerId,
      return_url: `${base}/app/billing`,
    });
    if (!session.url) {
      throw new ServiceUnavailableException('Stripe did not return a portal URL.');
    }
    return { url: session.url };
  }

  private requireStripeSecret(): string {
    const secret = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!secret) throw new ServiceUnavailableException('Stripe integration is not configured on the server.');
    return secret;
  }

  private webBaseUrl(): string {
    return (this.config.get<string>('WEB_BASE_URL') || this.config.get<string>('APP_WEB_URL') || 'https://venuewrangler.com').replace(/\/+$/, '');
  }

  private async resolveStripePriceId(secret: string, planType: 'single' | 'multi_venue' = 'single'): Promise<string> {
    if (planType === 'single') {
      const configured = this.config.get<string>('STRIPE_PRICE_ID');
      if (configured) return configured;
      if (this.cachedStripePriceId) return this.cachedStripePriceId;
    } else {
      const configuredMulti = this.config.get<string>('STRIPE_MULTI_VENUE_PRICE_ID');
      if (configuredMulti) return configuredMulti;
      if (this.cachedStripeMultiVenuePriceId) return this.cachedStripeMultiVenuePriceId;
    }

    const lookupKey = planType === 'multi_venue' ? STRIPE_MULTI_PRICE_LOOKUP_KEY : STRIPE_PRICE_LOOKUP_KEY;
    const amountCents = planType === 'multi_venue' ? STRIPE_MULTI_AMOUNT_CENTS : STRIPE_PLAN_AMOUNT_CENTS;
    const productName = planType === 'multi_venue' ? 'Venue Wrangler Multi-Venue Pro' : 'Venue Wrangler';

    this.logger.warn(`STRIPE_PRICE_ID for ${planType} is not configured; resolving/creating price at request time.`);
    const found = await stripeRequest<{ data?: { id: string }[] }>(secret, 'GET', '/prices', {
      lookup_keys: [lookupKey],
      active: true,
      limit: 1,
    });
    const existing = found.data?.[0]?.id;
    if (existing) {
      if (planType === 'multi_venue') this.cachedStripeMultiVenuePriceId = existing;
      else this.cachedStripePriceId = existing;
      return existing;
    }

    const product = await stripeRequest<{ id: string }>(secret, 'POST', '/products', { name: productName });
    try {
      const price = await stripeRequest<{ id: string }>(secret, 'POST', '/prices', {
        product: product.id,
        unit_amount: amountCents,
        currency: 'usd',
        recurring: { interval: 'month' },
        lookup_key: lookupKey,
      });
      if (planType === 'multi_venue') this.cachedStripeMultiVenuePriceId = price.id;
      else this.cachedStripePriceId = price.id;
      return price.id;
    } catch (error) {
      this.logger.warn(`Stripe price creation failed, attempting re-fetch: ${error instanceof Error ? error.message : String(error)}`);
      const retry = await stripeRequest<{ data?: { id: string }[] }>(secret, 'GET', '/prices', {
        lookup_keys: [lookupKey],
        active: true,
        limit: 1,
      });
      const claimed = retry.data?.[0]?.id;
      if (claimed) {
        if (planType === 'multi_venue') this.cachedStripeMultiVenuePriceId = claimed;
        else this.cachedStripePriceId = claimed;
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
    this.assertAllowedAppleSync(body.productId, body.entitlementId);
    const verified = await this.verifyRevenueCatEntitlement(profile.venueId!, body.productId, body.entitlementId);
    if (!verified) {
      return this.getMyVenueBilling(user);
    }
    const status: SubscriptionStatus = 'active';
    const now = new Date();
    const isMulti = verified.productId === 'com.venuewrangler.multivenue.399';
    const priceCents = isMulti ? 39900 : 9999;
    const planId = isMulti ? 'venueflow_multi_venue_5' : verified.productId;

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing:${profile.venueId!}`}))`;
      const existing = await tx.subscription.findFirst({ where: { venueId: profile.venueId! } });
      await tx.venue.update({
        where: { id: profile.venueId! },
        data: {
          subscriptionStatus: status,
          subscriptionPlatform: 'apple',
        },
      });
      if (existing) {
        await tx.subscription.update({
          where: { id: existing.id },
          data: {
            status,
            platform: 'apple',
            planId,
            priceCents,
            currentPeriodStart: verified.currentPeriodStart ?? existing.currentPeriodStart ?? now,
            currentPeriodEnd: verified.currentPeriodEnd ?? existing.currentPeriodEnd,
            cancelAtPeriodEnd: false,
            cancelledAt: null,
            externalCustomerId: profile.venueId!,
            lastRevenueCatEventAt: now,
          },
        });
        return;
      }
      await tx.subscription.create({
        data: {
          venueId: profile.venueId!,
          status,
          platform: 'apple',
          planId,
          priceCents,
          currency: 'USD',
          // status is always 'active' here (verified real-money entitlement),
          // never a trial — leave trial dates unset rather than stamping
          // "now" for both, which would misrepresent this as an instantly
          // expired trial.
          trialStartedAt: null,
          trialEndsAt: null,
          currentPeriodStart: verified.currentPeriodStart ?? now,
          currentPeriodEnd: verified.currentPeriodEnd,
          cancelAtPeriodEnd: false,
          externalCustomerId: profile.venueId!,
          lastRevenueCatEventAt: now,
        },
      });
    });

    return this.getMyVenueBilling(user);
  }

  private assertAllowedAppleSync(productId: string, entitlementId?: string) {
    const allowedProducts = new Set(this.csvEnv('REVENUECAT_ALLOWED_PRODUCT_IDS', 'com.venuewrangler.monthly,com.venuewrangler.multivenue.399'));
    const allowedEntitlements = new Set(this.csvEnv('REVENUECAT_ALLOWED_ENTITLEMENTS', 'pro,multi_venue'));
    if (!allowedProducts.has(productId)) {
      throw new BadRequestException('That Apple subscription product is not allowed for this app.');
    }
    if (entitlementId && !allowedEntitlements.has(entitlementId)) {
      throw new BadRequestException('That RevenueCat entitlement is not allowed for this app.');
    }
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
    const allowedEntitlements = new Set(this.csvEnv('REVENUECAT_ALLOWED_ENTITLEMENTS', 'pro,multi_venue'));
    const requestedEntitlement = entitlementId ? entitlements[entitlementId] : undefined;
    if (requestedEntitlement && requestedEntitlement.product_identifier !== productId) {
      throw new BadRequestException('RevenueCat entitlement does not match the requested Apple subscription product.');
    }
    const matchingEntitlement = entitlementId
      ? requestedEntitlement
      : Object.entries(entitlements).find(([key, entitlement]: [string, any]) =>
          allowedEntitlements.has(key) && entitlement?.product_identifier === productId,
        )?.[1];
    const matchingSubscription = subscriptions[productId];
    const expiresAt = parseRevenueCatDate(matchingEntitlement?.expires_date ?? matchingSubscription?.expires_date);
    const purchasedAt = parseRevenueCatDate(matchingEntitlement?.purchase_date ?? matchingSubscription?.purchase_date);
    const isActive = Boolean(matchingEntitlement || matchingSubscription) && (!expiresAt || expiresAt.getTime() > Date.now());
    if (!isActive) {
      throw new BadRequestException('No active RevenueCat entitlement found for this Apple subscription.');
    }

    return { productId, currentPeriodStart: purchasedAt, currentPeriodEnd: expiresAt };
  }

  private csvEnv(key: string, fallback: string): string[] {
    const raw = this.config.get<string>(key) ?? fallback;
    return raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }
}

function parseRevenueCatDate(value: unknown) {
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
