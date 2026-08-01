import { describe, expect, it } from 'vitest';
import { safeRequestPath } from './all-exceptions.filter';

function request(overrides: Partial<Parameters<typeof safeRequestPath>[0]> = {}) {
  return {
    baseUrl: '/api/v1/app',
    path: '/invite/secret-token',
    originalUrl: '/api/v1/app/invite/secret-token?token=media-jwt',
    url: '/invite/secret-token?token=media-jwt',
    ...overrides,
  } as Parameters<typeof safeRequestPath>[0];
}

describe('safeRequestPath', () => {
  it('uses the matched route template and omits query credentials', () => {
    expect(safeRequestPath(request({ route: { path: '/invite/:code' } }))).toBe('/api/v1/app/invite/:code');
  });

  it('redacts invite credentials when no route template is available', () => {
    expect(safeRequestPath(request({ baseUrl: '', route: undefined }))).toBe('/invite/:code');
  });

  it('drops media tokens from ordinary fallback paths', () => {
    expect(
      safeRequestPath(
        request({
          baseUrl: '',
          path: '/v1/chat/images/image-1',
          route: undefined,
        }),
      ),
    ).toBe('/v1/chat/images/image-1');
  });
});
