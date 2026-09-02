import { describe, expect, it } from 'vitest';
import { jsonBodyLimitForPath } from './body-limit';

describe('jsonBodyLimitForPath', () => {
  it.each([
    '/api/v1/chat/images',
    '/api/v1/bar-inventory/parse',
    '/api/v1/operations/checklist/complete/completion-1',
    '/api/v1/documents',
    // A max-size POS delivery (1000 checks + 1000 labor punches) measures
    // ~1.08 MB, so the 1mb default rejected it with a 413 before Nest saw it.
    '/api/v1/pos/ingest/venue-1',
    '/api/v1/reservations/ingest/venue-1',
  ])('allows the configured large-body limit for %s', (path) => {
    expect(jsonBodyLimitForPath(path, '8mb')).toBe('8mb');
  });

  it('keeps ordinary JSON routes at 1mb', () => {
    expect(jsonBodyLimitForPath('/api/v1/reservations', '8mb')).toBe('1mb');
  });

  it('does not extend the large limit past the ingest path segment', () => {
    // `[^/]+` must not swallow a deeper path, or an unintended route inherits
    // the 16 MB ceiling.
    expect(jsonBodyLimitForPath('/api/v1/pos/ingest/venue-1/extra', '8mb')).toBe('1mb');
    expect(jsonBodyLimitForPath('/api/v1/pos/ingest', '8mb')).toBe('1mb');
  });
});
