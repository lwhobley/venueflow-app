import { describe, expect, it } from 'vitest';
import { assignmentDayKeys, occupiedSlots, shiftsOverlap } from './shift-overlap';

describe('occupiedSlots', () => {
  it('keeps a same-day shift on one day', () => {
    expect(occupiedSlots({ weekStart: '2026-08-23', dayIndex: 1, startMinutes: 540, endMinutes: 900 })).toEqual([
      { weekStart: '2026-08-23', dayIndex: 1, start: 540, end: 900 },
    ]);
  });

  it('splits an overnight shift onto the next calendar day', () => {
    expect(occupiedSlots({ weekStart: '2026-08-23', dayIndex: 0, startMinutes: 1320, endMinutes: 1560 })).toEqual([
      { weekStart: '2026-08-23', dayIndex: 0, start: 1320, end: 1440 },
      { weekStart: '2026-08-23', dayIndex: 1, start: 0, end: 120 },
    ]);
  });

  it('spills Saturday overnight into the next week Sunday', () => {
    expect(occupiedSlots({ weekStart: '2026-08-23', dayIndex: 6, startMinutes: 1320, endMinutes: 1560 })).toEqual([
      { weekStart: '2026-08-23', dayIndex: 6, start: 1320, end: 1440 },
      { weekStart: '2026-08-30', dayIndex: 0, start: 0, end: 120 },
    ]);
  });
});

describe('shiftsOverlap', () => {
  it('detects a Sunday overnight colliding with Monday morning', () => {
    expect(shiftsOverlap(
      { weekStart: '2026-08-23', dayIndex: 0, startMinutes: 1320, endMinutes: 1560 },
      { weekStart: '2026-08-23', dayIndex: 1, startMinutes: 60, endMinutes: 180 },
    )).toBe(true);
  });

  it('allows Sunday overnight and Monday after the spill ends', () => {
    expect(shiftsOverlap(
      { weekStart: '2026-08-23', dayIndex: 0, startMinutes: 1320, endMinutes: 1560 },
      { weekStart: '2026-08-23', dayIndex: 1, startMinutes: 180, endMinutes: 360 },
    )).toBe(false);
  });

  it('does not treat this week Sunday as Saturday overnight spill', () => {
    expect(shiftsOverlap(
      { weekStart: '2026-08-23', dayIndex: 6, startMinutes: 1320, endMinutes: 1560 },
      { weekStart: '2026-08-23', dayIndex: 0, startMinutes: 0, endMinutes: 180 },
    )).toBe(false);
  });

  it('detects Saturday overnight colliding with next-week Sunday morning', () => {
    expect(shiftsOverlap(
      { weekStart: '2026-08-23', dayIndex: 6, startMinutes: 1320, endMinutes: 1560 },
      { weekStart: '2026-08-30', dayIndex: 0, startMinutes: 60, endMinutes: 180 },
    )).toBe(true);
  });
});

describe('assignmentDayKeys', () => {
  it('locks both calendar days of an overnight shift', () => {
    expect(assignmentDayKeys({ weekStart: '2026-08-23', dayIndex: 0, startMinutes: 1320, endMinutes: 1560 })).toEqual([
      { weekStart: '2026-08-23', dayIndex: 0 },
      { weekStart: '2026-08-23', dayIndex: 1 },
    ]);
  });
});
