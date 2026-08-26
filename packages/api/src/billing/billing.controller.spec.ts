import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertWithinSharedRateLimit } from '../common/rate-limit';
import { verifyStripeSignature } from '../common/webhook-auth';
import { BillingController } from './billing.controller';

vi.mock('../common/rate-limit', () => ({
  assertWithinSharedRateLimit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../common/webhook-auth', async () => {
  const actual = await vi.importActual<typeof import('../common/webhook-auth')>('../common/webhook-auth');
  return {
    ...actual,
    verifyStripeSignature: vi.fn(),
  };
});

describe('BillingController webhook authentication', () => {
  beforeEach(() => {
    vi.mocked(assertWithinSharedRateLimit).mockClear();
    vi.mocked(verifyStripeSignature).mockReset();
  });

  it('fails closed when the RevenueCat secret is missing and does not rate-limit', async () => {
    const controller = new BillingController({} as any, { get: vi.fn() } as any);

    await expect(controller.revenueCatWebhook(
      { ip: '127.0.0.1' } as any,
      undefined,
      { event: { id: 'evt-1', type: 'RENEWAL', app_user_id: 'venue-1' } } as any,
    )).rejects.toBeInstanceOf(UnauthorizedException);
    expect(assertWithinSharedRateLimit).not.toHaveBeenCalled();
  });

  it('rejects an invalid RevenueCat secret before rate limiting', async () => {
    const config = {
      get: vi.fn((key: string) => (key === 'REVENUECAT_WEBHOOK_SECRET' ? 'secret' : undefined)),
    };
    const controller = new BillingController({} as any, config as any);

    await expect(controller.revenueCatWebhook(
      { ip: '127.0.0.1' } as any,
      'Bearer wrong',
      { event: { id: 'evt-1', type: 'RENEWAL', app_user_id: 'venue-1' } } as any,
    )).rejects.toBeInstanceOf(UnauthorizedException);
    expect(assertWithinSharedRateLimit).not.toHaveBeenCalled();
  });

  it('rate-limits only after a valid RevenueCat secret', async () => {
    const config = {
      get: vi.fn((key: string) => (key === 'REVENUECAT_WEBHOOK_SECRET' ? 'secret' : undefined)),
    };
    const controller = new BillingController({} as any, config as any);

    await expect(controller.revenueCatWebhook(
      { ip: '127.0.0.1' } as any,
      'Bearer secret',
      {
        event: {
          id: 'evt-1',
          type: 'RENEWAL',
          app_user_id: 'venue-1',
          product_id: 'another-app.product',
        },
      } as any,
    )).resolves.toEqual({ ok: true, ignored: true });
    expect(assertWithinSharedRateLimit).toHaveBeenCalledOnce();
  });

  it('ignores signed RevenueCat events for unrelated products', async () => {
    const config = {
      get: vi.fn((key: string) => (key === 'REVENUECAT_WEBHOOK_SECRET' ? 'secret' : undefined)),
    };
    const controller = new BillingController({} as any, config as any);

    await expect(controller.revenueCatWebhook(
      { ip: '127.0.0.1' } as any,
      'Bearer secret',
      {
        event: {
          id: 'evt-1',
          type: 'RENEWAL',
          app_user_id: 'venue-1',
          product_id: 'another-app.product',
        },
      } as any,
    )).resolves.toEqual({ ok: true, ignored: true });
  });

  it('ignores signed RevenueCat events with neither product nor entitlement identifiers', async () => {
    const config = {
      get: vi.fn((key: string) => (key === 'REVENUECAT_WEBHOOK_SECRET' ? 'secret' : undefined)),
    };
    const controller = new BillingController({} as any, config as any);

    await expect(controller.revenueCatWebhook(
      { ip: '127.0.0.1' } as any,
      'Bearer secret',
      { event: { id: 'evt-no-product', type: 'RENEWAL', app_user_id: 'venue-1' } } as any,
    )).resolves.toEqual({ ok: true, ignored: true });
  });

  it('fails closed when the Stripe secret is missing and does not rate-limit', async () => {
    const controller = new BillingController({} as any, { get: vi.fn() } as any);

    await expect(controller.stripeWebhook(
      { ip: '127.0.0.1', rawBody: Buffer.from('{}') } as any,
      'sig',
      { id: 'evt_1', type: 'customer.subscription.updated' } as any,
    )).rejects.toBeInstanceOf(UnauthorizedException);
    expect(assertWithinSharedRateLimit).not.toHaveBeenCalled();
    expect(verifyStripeSignature).not.toHaveBeenCalled();
  });

  it('rejects an invalid Stripe signature before rate limiting', async () => {
    const config = {
      get: vi.fn((key: string) => (key === 'STRIPE_WEBHOOK_SECRET' ? 'whsec_test' : undefined)),
    };
    vi.mocked(verifyStripeSignature).mockReturnValue(false);
    const controller = new BillingController({} as any, config as any);

    await expect(controller.stripeWebhook(
      { ip: '127.0.0.1', rawBody: Buffer.from('{}') } as any,
      'bad-sig',
      { id: 'evt_1', type: 'customer.subscription.updated' } as any,
    )).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verifyStripeSignature).toHaveBeenCalledOnce();
    expect(assertWithinSharedRateLimit).not.toHaveBeenCalled();
  });

  it('rate-limits only after a valid Stripe signature', async () => {
    const config = {
      get: vi.fn((key: string) => (key === 'STRIPE_WEBHOOK_SECRET' ? 'whsec_test' : undefined)),
    };
    vi.mocked(verifyStripeSignature).mockReturnValue(true);
    const controller = new BillingController({} as any, config as any);

    await expect(controller.stripeWebhook(
      { ip: '127.0.0.1', rawBody: Buffer.from('{}') } as any,
      'good-sig',
      { id: 'evt_1', type: 'invoice.created', data: { object: {} } } as any,
    )).resolves.toEqual({ ok: true, ignored: true });
    expect(verifyStripeSignature).toHaveBeenCalledOnce();
    expect(assertWithinSharedRateLimit).toHaveBeenCalledOnce();
  });
});

describe('BillingController applySubscription P2002 handling', () => {
  function makeController(transactionImpl: () => Promise<unknown>) {
    const prisma = { $transaction: vi.fn(transactionImpl) };
    const controller = new BillingController(prisma as any, { get: vi.fn() } as any);
    return { controller, prisma };
  }

  const input = {
    venueId: 'venue-1',
    status: 'active' as const,
    planId: 'plan-1',
    eventId: 'evt-1',
    eventType: 'customer.subscription.updated',
  };

  it('swallows a P2002 on the SubscriptionEvent replay-dedupe constraint', async () => {
    const error = Object.assign(new Error('duplicate'), { code: 'P2002', meta: { target: ['source', 'externalEventId'] } });
    const { controller } = makeController(() => Promise.reject(error));

    await expect(controller.applyStripeSubscription(input)).resolves.toEqual({ ok: true, duplicate: true });
  });

  it('re-throws a P2002 on any other constraint instead of returning a fake success', async () => {
    // e.g. Subscription.externalSubscriptionId already bound to a different
    // venue — a real conflict, not a replayed webhook delivery. Swallowing
    // this would tell Stripe/RevenueCat the event was handled when the
    // venue's subscription state was never actually updated.
    const error = Object.assign(new Error('duplicate'), { code: 'P2002', meta: { target: ['externalSubscriptionId'] } });
    const { controller } = makeController(() => Promise.reject(error));

    await expect(controller.applyStripeSubscription(input)).rejects.toBe(error);
  });

  it('re-throws a P2002 with no meta.target at all', async () => {
    const error = Object.assign(new Error('duplicate'), { code: 'P2002' });
    const { controller } = makeController(() => Promise.reject(error));

    await expect(controller.applyStripeSubscription(input)).rejects.toBe(error);
  });

  it('ignores single-venue RevenueCat events when the owner has more than one venue', async () => {
    const prisma = {
      venue: { findUnique: vi.fn().mockResolvedValue(null) },
      profile: {
        findMany: vi.fn().mockResolvedValue([
          { venueId: 'venue-latest', createdAt: new Date(2000) },
          { venueId: 'venue-older', createdAt: new Date(1000) },
        ]),
      },
      $transaction: vi.fn().mockImplementation(async (cb: any) => cb({
        $executeRaw: vi.fn().mockResolvedValue(undefined),
        venue: { findUnique: vi.fn().mockResolvedValue({ id: 'venue-latest' }), update: vi.fn().mockResolvedValue({}) },
        subscription: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
        subscriptionEvent: { create: vi.fn().mockResolvedValue({}) },
      })),
    };
    const config = {
      get: vi.fn((key: string) => {
        if (key === 'REVENUECAT_WEBHOOK_SECRET') return 'secret';
        if (key === 'REVENUECAT_ALLOWED_PRODUCT_IDS') return 'com.venuewrangler.monthly';
        return undefined;
      }),
    };
    const controller = new BillingController(prisma as any, config as any);

    const result = await controller.revenueCatWebhook(
      { ip: '127.0.0.1' } as any,
      'Bearer secret',
      {
        event: {
          id: 'evt-1',
          type: 'INITIAL_PURCHASE',
          app_user_id: 'user-multi-owner',
          product_id: 'com.venuewrangler.monthly',
          purchased_at_ms: Date.now(),
          expiration_at_ms: Date.now() + 86400000,
        },
      } as any,
    );
    expect(result).toEqual({ ok: true, ignored: true });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
