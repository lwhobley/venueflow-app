import { describe, expect, it } from 'vitest';
import { overnightAwareRange, zonedDateTimeMs, zonedIsoDate, zonedWeekDates } from './zoned-datetime';

describe('zonedIsoDate', () => {
  it('reports the venue-local calendar date, not the UTC one', () => {
    // 2026-08-03T02:30:00Z is already 2026-08-02 in America/Los_Angeles (UTC-7).
    const at = new Date('2026-08-03T02:30:00.000Z');
    expect(zonedIsoDate('America/Los_Angeles', at)).toBe('2026-08-02');
    expect(zonedIsoDate('UTC', at)).toBe('2026-08-03');
  });
});

describe('zonedDateTimeMs', () => {
  it('resolves an ordinary wall-clock time to the correct UTC instant', () => {
    // 14:00 EST (UTC-5, no DST in effect) = 19:00 UTC.
    expect(zonedDateTimeMs('2026-01-15', '14:00', 'America/New_York')).toBe(
      Date.parse('2026-01-15T19:00:00.000Z'),
    );
  });

  it('resolves a wall-clock time after a spring-forward transition to the new offset', () => {
    // Regression: a single-pass correction previously read the pre-transition
    // (EST) offset for any wall-clock time after 2026-03-08's 2am->3am jump,
    // returning an instant an hour early. 06:00 on transition day is
    // already EDT (UTC-4) = 10:00 UTC, not 11:00 UTC.
    expect(zonedDateTimeMs('2026-03-08', '06:00', 'America/New_York')).toBe(
      Date.parse('2026-03-08T10:00:00.000Z'),
    );
  });

  it('resolves a wall-clock time before a spring-forward transition to the old offset', () => {
    // 01:00 on transition day is still EST (UTC-5) = 06:00 UTC.
    expect(zonedDateTimeMs('2026-03-08', '01:00', 'America/New_York')).toBe(
      Date.parse('2026-03-08T06:00:00.000Z'),
    );
  });

  it('resolves a wall-clock time after a fall-back transition to the new offset', () => {
    // 06:00 the morning of the fall-back day is unambiguously EST (UTC-5).
    expect(zonedDateTimeMs('2026-11-01', '06:00', 'America/New_York')).toBe(
      Date.parse('2026-11-01T11:00:00.000Z'),
    );
  });
});

describe('zonedWeekDates', () => {
  it('builds a Sunday-Saturday week anchored to the venue calendar, read back via UTC', () => {
    // 2026-08-05 is a Wednesday. The venue-local week must run 08-02..08-08
    // regardless of what day it is on the device.
    const wednesday = new Date('2026-08-05T15:00:00.000Z');
    const week = zonedWeekDates('America/New_York', wednesday);

    expect(week).toHaveLength(7);
    const isoLabels = week.map((d) => d.toISOString().slice(0, 10));
    expect(isoLabels).toEqual([
      '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05',
      '2026-08-06', '2026-08-07', '2026-08-08',
    ]);
  });

  it('does not desync when the device and venue disagree on the calendar day', () => {
    // Regression for VW-21: 2026-08-03T02:30:00Z is 2026-08-02 22:30 local in
    // America/New_York (still Sunday night there) but already 2026-08-03
    // (Monday) UTC. The venue's week must start from ITS Sunday (08-02), not
    // from whatever weekday the raw instant's UTC/device date happens to be.
    const at = new Date('2026-08-03T02:30:00.000Z');
    const week = zonedWeekDates('America/New_York', at);

    expect(week[0].toISOString().slice(0, 10)).toBe('2026-08-02');
    expect(week[6].toISOString().slice(0, 10)).toBe('2026-08-08');
  });
});

describe('overnightAwareRange', () => {
  it('spans exactly 8 real hours on an ordinary (non-DST) night', () => {
    const { start, end } = overnightAwareRange('2026-08-15', '22:00', '06:00', 'America/New_York');
    expect(end - start).toBe(8 * 60 * 60 * 1000);
  });

  it('spans 23 real hours across a spring-forward transition', () => {
    // Regression for VW-22: a flat +24h previously overcounted by an hour on
    // the one night of the year the local day is actually 23 hours long.
    // America/New_York springs forward 2026-03-08 02:00 -> 03:00.
    const { start, end } = overnightAwareRange('2026-03-07', '22:00', '06:00', 'America/New_York');
    expect(end - start).toBe(7 * 60 * 60 * 1000);
  });

  it('spans 25 real hours across a fall-back transition', () => {
    // America/New_York falls back 2026-11-01 02:00 -> 01:00.
    const { start, end } = overnightAwareRange('2026-10-31', '22:00', '06:00', 'America/New_York');
    expect(end - start).toBe(9 * 60 * 60 * 1000);
  });
});
