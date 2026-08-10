import { UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { describe, expect, it, vi } from 'vitest';
import { MediaAccessService } from './media-access.service';

describe('MediaAccessService', () => {
  it('issues an expiring token bound to the resource and venue', async () => {
    const jwt = {
      signAsync: vi.fn().mockResolvedValue('signed-token'),
      verifyAsync: vi.fn(),
    } as unknown as JwtService;
    const service = new MediaAccessService(jwt);

    await expect(service.createPath('chat-image', 'image-1', 'venue-1', '/v1/chat/images/image-1'))
      .resolves.toBe('/v1/chat/images/image-1?token=signed-token');
    expect(jwt.signAsync).toHaveBeenCalledWith(
      { purpose: 'media-access', kind: 'chat-image', mediaId: 'image-1', venueId: 'venue-1' },
      { expiresIn: '3m' },
    );
  });

  it('rejects a token issued for another venue', async () => {
    const jwt = {
      signAsync: vi.fn(),
      verifyAsync: vi.fn().mockResolvedValue({
        purpose: 'media-access',
        kind: 'chat-image',
        mediaId: 'image-1',
        venueId: 'venue-2',
      }),
    } as unknown as JwtService;
    const service = new MediaAccessService(jwt);

    await expect(service.assertToken('token', 'chat-image', 'image-1', 'venue-1'))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each([
    ['wrong purpose', { purpose: 'session', kind: 'chat-image', mediaId: 'image-1', venueId: 'venue-1' }],
    ['wrong media kind', { purpose: 'media-access', kind: 'checklist-photo', mediaId: 'image-1', venueId: 'venue-1' }],
    ['wrong media id', { purpose: 'media-access', kind: 'chat-image', mediaId: 'image-2', venueId: 'venue-1' }],
  ])('rejects a token with %s', async (_label, claims) => {
    const jwt = {
      signAsync: vi.fn(),
      verifyAsync: vi.fn().mockResolvedValue(claims),
    } as unknown as JwtService;
    const service = new MediaAccessService(jwt);

    await expect(service.assertToken('token', 'chat-image', 'image-1', 'venue-1'))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects missing, invalid, or expired tokens', async () => {
    const jwt = {
      signAsync: vi.fn(),
      verifyAsync: vi.fn().mockRejectedValue(new Error('jwt expired')),
    } as unknown as JwtService;
    const service = new MediaAccessService(jwt);

    await expect(service.assertToken(undefined, 'chat-image', 'image-1', 'venue-1'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.assertToken('expired-token', 'chat-image', 'image-1', 'venue-1'))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });
});
