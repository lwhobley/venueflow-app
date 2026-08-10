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
