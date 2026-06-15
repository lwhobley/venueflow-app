import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionStatus } from '@prisma/client';
import { IsOptional, IsString } from 'class-validator';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../auth/auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { toMs } from './app-mappers';
import { ProfileService } from './profile.service';

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

  @UseGuards(AuthGuard)
  @Post('billing/apple/sync')
  async syncAppleSubscription(@CurrentUser() user: AuthUser, @Body() body: AppleSubscriptionSyncDto) {
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
    });
    const json: any = await response.json().catch(() => null);
    if (!response.ok) {
      throw new BadRequestException(json?.message ?? 'Could not verify RevenueCat subscription.');
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
