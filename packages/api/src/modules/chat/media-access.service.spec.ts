import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaAccessService } from './media-access.service';

function makeService() {
  const config = {
    get: vi.fn().mockReturnValue('test-secret-key'),
  } as unknown as ConfigService;
  return new MediaAccessService(config);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('MediaAccessService', () => {
  it('produces an opaque token that validates for the same resource', () => {
    const service = makeService();
    const path = service.createPath('chat-image', 'image-1', 'venue-1', '/v1/chat/images/image-1');

    // Path contains token and bucket params
    expect(path).toMatch(/^\/v1\/chat\/images\/image-1\?token=[a-f0-9]{64}&t=\d+$/);

    // Extract token from path
    const url = new URL(path, 'http://localhost');
    const token = url.searchParams.get('token')!;

    // Should validate without throwing
    expect(() => service.assertToken(token, 'chat-image', 'image-1', 'venue-1')).not.toThrow();
  });

  it('rejects a token issued for a different venue', () => {
    const service = makeService();
    const path = service.createPath('chat-image', 'image-1', 'venue-1', '/v1/chat/images/image-1');
    const token = new URL(path, 'http://localhost').searchParams.get('token')!;

    expect(() => service.assertToken(token, 'chat-image', 'image-1', 'venue-2'))
      .toThrow(UnauthorizedException);
  });

  it('rejects a token issued for a different media kind', () => {
    const service = makeService();
    const path = service.createPath('chat-image', 'image-1', 'venue-1', '/v1/chat/images/image-1');
    const token = new URL(path, 'http://localhost').searchParams.get('token')!;

    expect(() => service.assertToken(token, 'checklist-photo', 'image-1', 'venue-1'))
      .toThrow(UnauthorizedException);
  });

  it('rejects a token issued for a different media ID', () => {
    const service = makeService();
    const path = service.createPath('chat-image', 'image-1', 'venue-1', '/v1/chat/images/image-1');
    const token = new URL(path, 'http://localhost').searchParams.get('token')!;

    expect(() => service.assertToken(token, 'chat-image', 'image-2', 'venue-1'))
      .toThrow(UnauthorizedException);
  });

  it('rejects a missing token', () => {
    const service = makeService();

    expect(() => service.assertToken(undefined, 'chat-image', 'image-1', 'venue-1'))
      .toThrow(UnauthorizedException);
  });

  it('rejects a non-string token (query arrays fail closed)', () => {
    const service = makeService();

    expect(() => service.assertToken(['a', 'b'], 'chat-image', 'image-1', 'venue-1'))
      .toThrow(UnauthorizedException);
  });

  it('rejects a tampered token', () => {
    const service = makeService();

    expect(() => service.assertToken('deadbeef'.repeat(8), 'chat-image', 'image-1', 'venue-1'))
      .toThrow(UnauthorizedException);
  });
});
