import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { calculateRequestHours, parseIsoCalendarDate } from './staff-requests.controller';

describe('parseIsoCalendarDate', () => {
  it('parses a valid YYYY-MM-DD to a noon-UTC anchor', () => {
    const d = parseIsoCalendarDate('2026-07-14');
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2026);
    expect(d!.getUTCMonth()).toBe(6); // July
    expect(d!.getUTCDate()).toBe(14);
    expect(d!.getUTCHours()).toBe(12);
  });

  it('derives weekday independent of timezone (getUTCDay on the anchor)', () => {
    // 2023-01-01 was a Sunday (0); 2023-01-03 a Tuesday (2).
    expect(parseIsoCalendarDate('2023-01-01')!.getUTCDay()).toBe(0);
    expect(parseIsoCalendarDate('2023-01-03')!.getUTCDay()).toBe(2);
  });

  it('rejects malformed strings', () => {
    expect(parseIsoCalendarDate('2026-7-14')).toBeNull();
    expect(parseIsoCalendarDate('07/14/2026')).toBeNull();
    expect(parseIsoCalendarDate('not-a-date')).toBeNull();
  });

  it('rejects impossible calendar dates', () => {
    expect(parseIsoCalendarDate('2026-02-31')).toBeNull();
    expect(parseIsoCalendarDate('2023-02-29')).toBeNull(); // 2023 is not a leap year
    expect(parseIsoCalendarDate('2026-13-01')).toBeNull();
  });

  it('returns null for null/undefined/empty', () => {
    expect(parseIsoCalendarDate(null)).toBeNull();
    expect(parseIsoCalendarDate(undefined)).toBeNull();
    expect(parseIsoCalendarDate('')).toBeNull();
  });
});

describe('calculateRequestHours', () => {
  it('defaults to one day (8h) when no start date is given', () => {
    expect(calculateRequestHours()).toBe(8);
    expect(calculateRequestHours(null)).toBe(8);
  });

  it('counts a single day inclusively as 8h', () => {
    expect(calculateRequestHours('2026-07-14', '2026-07-14')).toBe(8);
    expect(calculateRequestHours('2026-07-14')).toBe(8); // no end => single day
  });

  it('counts a multi-day range inclusively', () => {
    expect(calculateRequestHours('2026-07-14', '2026-07-16')).toBe(24); // 3 days
    expect(calculateRequestHours('2026-07-14', '2026-07-20')).toBe(56); // 7 days
  });

  it('rejects a reversed range instead of returning a positive Math.abs result', () => {
    expect(() => calculateRequestHours('2026-07-16', '2026-07-14')).toThrow(BadRequestException);
  });

  it('rejects malformed/impossible dates instead of producing NaN', () => {
    expect(() => calculateRequestHours('2026-13-01', '2026-13-02')).toThrow(BadRequestException);
    expect(() => calculateRequestHours('garbage')).toThrow(BadRequestException);
    expect(() => calculateRequestHours('2026-07-14', '2026-02-31')).toThrow(BadRequestException);
  });

  it('always returns a finite, positive number for valid input', () => {
    const hours = calculateRequestHours('2026-01-01', '2026-12-31');
    expect(Number.isFinite(hours)).toBe(true);
    expect(hours).toBeGreaterThan(0);
    expect(hours).toBe(365 * 8); // 2026 is not a leap year
  });
});
