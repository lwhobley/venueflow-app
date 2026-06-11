import { describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { createRateLimiter } from './rate-limit';

describe('createRateLimiter', () => {
  it('allows up to max requests then throws 429', () => {
    const limit = createRateLimiter(3, 60_000);
    expect(() => limit('k')).not.toThrow();
    expect(() => limit('k')).not.toThrow();
    expect(() => limit('k')).not.toThrow();
    try {
      limit('k');
      throw new Error('expected a throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(429);
    }
  });

  it('isolates counts per key', () => {
    const limit = createRateLimiter(1, 60_000);
    expect(() => limit('a')).not.toThrow();
    expect(() => limit('b')).not.toThrow();
    expect(() => limit('a')).toThrow();
  });

  it('resets the window after it elapses', () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(0);
    const limit = createRateLimiter(1, 1000);
    expect(() => limit('k')).not.toThrow();
    expect(() => limit('k')).toThrow();
    now.mockReturnValue(1001);
    expect(() => limit('k')).not.toThrow();
    now.mockRestore();
  });
});
