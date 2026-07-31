import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PushController } from './push.controller';

describe('PushController', () => {
  it('requires an active venue scope', async () => {
    const controller = new PushController({} as any);
    await expect(controller.registerPushToken(undefined, { token: 'ExponentPushToken[test]', platform: 'ios' }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('binds a registered token to the authenticated profile and venue', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 'push-1' });
    const controller = new PushController({ pushToken: { upsert } } as any);

    await expect(controller.registerPushToken(
      { profileId: 'profile-1', venueId: 'venue-1' } as any,
      { token: 'ExponentPushToken[test]', platform: 'android' },
    )).resolves.toEqual({ id: 'push-1', ok: true });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { token: 'ExponentPushToken[test]' },
      update: expect.objectContaining({ profileId: 'profile-1', venueId: 'venue-1', enabled: true }),
    }));
  });
});
