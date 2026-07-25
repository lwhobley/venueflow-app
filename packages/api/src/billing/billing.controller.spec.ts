import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { BillingController } from './billing.controller';

vi.mock('../common/rate-limit', () => ({
  assertWithinSharedRateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('BillingController webhook authentication', () => {
  it('fails closed when the RevenueCat secret is missing', async () => {
    const controller = new BillingController({} as any, { get: vi.fn() } as any);

    await expect(controller.revenueCatWebhook(
      { ip: '127.0.0.1' } as any,
      undefined,
      { event: { id: 'evt-1', type: 'RENEWAL', app_user_id: 'venue-1' } } as any,
    )).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('ignores signed RevenueCat events for unrelated products', async () => {
    const config = {
      get: vi.fn((key: string) => key === 'REVENUECAT_WEBHOOK_SECRET' ? 'secret' : undefined),
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
});
