import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';

type Scope = VenueScopedRequest['venueScope'];

class CheckoutDto {
  @IsString()
  @IsOptional()
  priceId?: string;

  @IsString()
  successUrl!: string;

  @IsString()
  cancelUrl!: string;
}

class PortalDto {
  @IsString()
  returnUrl!: string;
}

function stripeKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new BadRequestException('Stripe is not configured');
  return key;
}

async function stripePost(path: string, params: Record<string, string>, key: string) {
  const body = new URLSearchParams(params).toString();
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const json = (await res.json()) as any;
  if (!res.ok) {
    throw new BadRequestException(json?.error?.message ?? 'Stripe request failed');
  }
  return json;
}

@Controller('v1/billing-actions')
export class BillingActionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('checkout')
  async createStripeCheckoutSession(@VenueScope() scope: Scope, @Body() body: CheckoutDto) {
    const key = stripeKey();
    const params: Record<string, string> = {
      'payment_method_types[]': 'card',
      mode: 'subscription',
      success_url: body.successUrl,
      cancel_url: body.cancelUrl,
    };
    if (body.priceId) {
      params['line_items[0][price]'] = body.priceId;
      params['line_items[0][quantity]'] = '1';
    }
    if (scope?.venueId) {
      const sub = await this.prisma.subscription.findFirst({
        where: { venueId: scope.venueId },
        select: { externalCustomerId: true },
      });
      if (sub?.externalCustomerId) {
        params.customer = sub.externalCustomerId;
      }
    }
    const session = await stripePost('/checkout/sessions', params, key);
    return { url: session.url as string };
  }

  @Post('portal')
  async createStripeBillingPortalSession(@VenueScope() scope: Scope, @Body() body: PortalDto) {
    const key = stripeKey();
    if (!scope?.venueId) throw new BadRequestException('No venue found');
    const sub = await this.prisma.subscription.findFirst({
      where: { venueId: scope.venueId },
      select: { externalCustomerId: true },
    });
    if (!sub?.externalCustomerId) throw new BadRequestException('No Stripe customer found for this venue');
    const session = await stripePost('/billing_portal/sessions', { customer: sub.externalCustomerId, return_url: body.returnUrl }, key);
    return { url: session.url as string };
  }
}
