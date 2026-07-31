import { describe, expect, it, vi } from 'vitest';
import { SupportController } from './support.controller';
import { assertWithinSharedRateLimit } from './common/rate-limit';

vi.mock('./common/rate-limit', () => ({
  assertWithinSharedRateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('SupportController', () => {
  it('rate-limits and sends a normalized support message', async () => {
    const email = { sendOrThrow: vi.fn().mockResolvedValue(undefined) };
    const controller = new SupportController(email as any, {} as any);
    const request = { ip: '127.0.0.1' } as any;

    await expect(controller.contact(request, {
      name: ' Test User ',
      email: ' USER@Example.com ',
      businessName: ' Test Venue ',
      topic: ' Billing ',
      message: ' Please help with my subscription. ',
    })).resolves.toEqual({ ok: true });

    expect(assertWithinSharedRateLimit).toHaveBeenCalled();
    expect(email.sendOrThrow).toHaveBeenCalledWith(expect.objectContaining({
      to: 'admin@venuewrangler.com',
      replyTo: 'user@example.com',
      subject: 'Venue Wrangler support: Billing',
    }));
  });
});
