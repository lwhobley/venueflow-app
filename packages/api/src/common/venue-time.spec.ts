import { describe, expect, it } from 'vitest';
import { zonedDateBounds, zonedDayBounds, zonedIsoDate } from './venue-time';

describe('zonedIsoDate', () => {
  it('renders a known instant in venue-local time', () => {
    // 2026-06-10T03:00:00Z is still June 9 in Los Angeles (UTC-7 in June).
    const ts = Date.UTC(2026, 5, 10, 3, 0, 0);
    expect(zonedIsoDate('America/Los_Angeles', ts)).toBe('2026-06-09');
    expect(zonedIsoDate('UTC', ts)).toBe('2026-06-10');
  });

  it('falls back to UTC for missing or invalid zones', () => {
    const ts = Date.UTC(2026, 5, 10, 3, 0, 0);
    expect(zonedIsoDate(null, ts)).toBe('2026-06-10');
    expect(zonedIsoDate('Not/AZone', ts)).toBe('2026-06-10');
  });
});

describe('zonedDayBounds', () => {
  it('returns a ~24h window whose start renders as local midnight', () => {
    const { start, end } = zonedDayBounds('America/New_York', 0);
    // 23-25h tolerance: DST transition days are legitimately shorter/longer.
    expect(end - start).toBeGreaterThanOrEqual(23 * 60 * 60 * 1000);
    expect(end - start).toBeLessThanOrEqual(25 * 60 * 60 * 1000);
    const local = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      // h23 forces a 0-23 cycle so midnight is '00:00'. `hour12: false` is
      // ambiguous (h23 vs h24) and renders midnight as '24:00' under some
      // Node/ICU builds (e.g. CI), making the assertion environment-dependent.
      hourCycle: 'h23',
    }).format(new Date(start));
    expect(local).toBe('00:00');
  });

  it("today's window contains now, in the venue zone", () => {
    const now = Date.now();
    for (const tz of ['America/Los_Angeles', 'UTC', 'Asia/Tokyo']) {
      const { start, end } = zonedDayBounds(tz, 0);
      expect(start).toBeLessThanOrEqual(now);
      expect(end).toBeGreaterThan(now);
    }
  });

  it('offsetDays shifts the window by whole local days', () => {
    const today = zonedDayBounds('America/Chicago', 0);
    const yesterday = zonedDayBounds('America/Chicago', -1);
    expect(yesterday.end).toBe(today.start);
  });
});

describe('zonedDateBounds', () => {
  it('maps a Chicago calendar day to UTC across daylight saving time', () => {
    const spring = zonedDateBounds('America/Chicago', '2026-03-08');
    expect(new Date(spring.start).toISOString()).toBe('2026-03-08T06:00:00.000Z');
    expect(new Date(spring.end).toISOString()).toBe('2026-03-09T05:00:00.000Z');
  });
});
