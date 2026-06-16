import { describe, expect, it } from 'vitest';
import {
  addDays,
  isIsoDate,
  isValidPeriodLength,
  isWeekLocked,
  payPeriodStartFor,
  upcomingWeeks,
  weeksToCover,
  weekStartFor,
} from './pay-period';

const ANCHOR = '2024-01-07'; // Sunday
const LEN = 14;

describe('pay-period math', () => {
  it('validates ISO dates', () => {
    expect(isIsoDate('2026-06-16')).toBe(true);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('06/16/2026')).toBe(false);
  });

  it('finds the Sunday that starts a week', () => {
    expect(weekStartFor('2024-01-10')).toBe('2024-01-07'); // Wed -> Sun
    expect(weekStartFor('2024-01-07')).toBe('2024-01-07'); // Sun -> itself
    expect(weekStartFor('2024-01-13')).toBe('2024-01-07'); // Sat -> Sun
  });

  it('buckets dates into repeating pay periods from the anchor', () => {
    expect(payPeriodStartFor('2024-01-07', ANCHOR, LEN)).toBe('2024-01-07');
    expect(payPeriodStartFor('2024-01-20', ANCHOR, LEN)).toBe('2024-01-07'); // day 13
    expect(payPeriodStartFor('2024-01-21', ANCHOR, LEN)).toBe('2024-01-21'); // day 14 -> next
    expect(payPeriodStartFor('2024-02-04', ANCHOR, LEN)).toBe('2024-02-04');
  });

  it('handles dates before the anchor', () => {
    expect(payPeriodStartFor('2024-01-06', ANCHOR, LEN)).toBe('2023-12-24');
  });

  it('locks weeks whose period has begun and leaves future periods editable', () => {
    const today = '2024-01-10'; // inside the 01-07..01-20 period
    // current period weeks: locked
    expect(isWeekLocked({ weekStart: '2024-01-07', today, anchor: ANCHOR, lengthDays: LEN, unlocked: false })).toBe(true);
    expect(isWeekLocked({ weekStart: '2024-01-14', today, anchor: ANCHOR, lengthDays: LEN, unlocked: false })).toBe(true);
    // next period weeks: editable
    expect(isWeekLocked({ weekStart: '2024-01-21', today, anchor: ANCHOR, lengthDays: LEN, unlocked: false })).toBe(false);
    expect(isWeekLocked({ weekStart: '2024-01-28', today, anchor: ANCHOR, lengthDays: LEN, unlocked: false })).toBe(false);
  });

  it('venue-wide unlock overrides the lock', () => {
    expect(isWeekLocked({ weekStart: '2024-01-07', today: '2024-01-10', anchor: ANCHOR, lengthDays: LEN, unlocked: true })).toBe(false);
  });

  it('lists upcoming week-starts beginning with the current week', () => {
    expect(upcomingWeeks('2024-01-10', 4)).toEqual(['2024-01-07', '2024-01-14', '2024-01-21', '2024-01-28']);
  });

  it('adds days across month boundaries', () => {
    expect(addDays('2024-01-31', 1)).toBe('2024-02-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29'); // leap year
  });

  it('accepts only whole-week pay periods (7..28)', () => {
    expect(isValidPeriodLength(7)).toBe(true);
    expect(isValidPeriodLength(14)).toBe(true);
    expect(isValidPeriodLength(28)).toBe(true);
    expect(isValidPeriodLength(10)).toBe(false); // not a multiple of 7
    expect(isValidPeriodLength(35)).toBe(false); // too long
    expect(isValidPeriodLength(0)).toBe(false);
  });

  it('covers two periods of weeks so an editable week always exists', () => {
    expect(weeksToCover(14)).toBe(4);
    expect(weeksToCover(7)).toBe(2);
    expect(weeksToCover(28)).toBe(8);
    // The last-covered week sits in the next (editable) period, not the current one.
    const today = '2024-01-07';
    const weeks = upcomingWeeks(today, weeksToCover(28));
    const lastWeek = weeks[weeks.length - 1];
    expect(isWeekLocked({ weekStart: lastWeek, today, anchor: ANCHOR, lengthDays: 28, unlocked: false })).toBe(false);
  });
});
