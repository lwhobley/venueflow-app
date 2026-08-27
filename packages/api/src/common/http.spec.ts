import { describe, expect, it } from 'vitest';
import { venueIdHeader } from './http';

describe('venueIdHeader', () => {
  it('returns the trimmed header value', () => {
    expect(venueIdHeader({ 'x-venue-id': '  venue-1  ' } as any)).toBe('venue-1');
  });

  it('returns undefined when the header is absent', () => {
    expect(venueIdHeader({} as any)).toBeUndefined();
  });

  it('returns undefined for a blank header', () => {
    expect(venueIdHeader({ 'x-venue-id': '   ' } as any)).toBeUndefined();
  });

  it('returns undefined rather than throwing for a duplicated header (array value)', () => {
    // Express parses a repeated header as string[]; without this guard a
    // caller building `where: { venueId }` from the raw value would hand
    // Prisma an array where it expects a scalar.
    expect(venueIdHeader({ 'x-venue-id': ['venue-1', 'venue-2'] } as any)).toBeUndefined();
  });
});
