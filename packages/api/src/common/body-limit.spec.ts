import { describe, expect, it } from 'vitest';
import { jsonBodyLimitForPath } from './body-limit';

describe('jsonBodyLimitForPath', () => {
  it.each([
    '/api/v1/chat/images',
    '/api/v1/bar-inventory/parse',
    '/api/v1/operations/checklist/complete/completion-1',
  ])('allows the configured image limit for %s', (path) => {
    expect(jsonBodyLimitForPath(path, '8mb')).toBe('8mb');
  });

  it('keeps ordinary JSON routes at 1mb', () => {
    expect(jsonBodyLimitForPath('/api/v1/reservations', '8mb')).toBe('1mb');
  });
});
