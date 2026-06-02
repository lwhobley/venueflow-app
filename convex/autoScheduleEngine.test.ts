import { describe, expect, it } from 'vitest';
import {
  autoAssignShifts,
  availabilityAllowsShift,
  blocksDoubleBook,
  timeRangesOverlap,
  type EngineStaff,
  type EngineOpenShift,
} from './autoScheduleEngine';

const T = (h: number) => h * 60; // hours → minutes

function staff(over: Partial<EngineStaff> & { profileId: string }): EngineStaff {
  return {
    role: 'server',
    jobTitle: 'Server',
    availability: [],
    assignedMinutes: 0,
    assignedBlocks: [],
    ...over,
  };
}

const shift = (id: string, dayIndex: number, start: number, end: number, jobTitle = 'Server'): EngineOpenShift => ({
  shiftId: id,
  dayIndex,
  startMinutes: start,
  endMinutes: end,
  jobTitle,
});

describe('timeRangesOverlap', () => {
  it('detects overlap and treats touching edges as non-overlapping', () => {
    expect(timeRangesOverlap(T(9), T(17), T(16), T(20))).toBe(true);
    expect(timeRangesOverlap(T(9), T(12), T(12), T(17))).toBe(false);
    expect(timeRangesOverlap(T(9), T(17), T(18), T(20))).toBe(false);
  });
});

describe('availabilityAllowsShift', () => {
  it('allows when there is no availability data for the day (unknown intent)', () => {
    expect(availabilityAllowsShift([], 1, T(9), T(17))).toBe(true);
  });

  it('allows when an available window fully covers the shift', () => {
    const avail = [{ dayIndex: 1, startMinutes: T(8), endMinutes: T(18), available: true }];
    expect(availabilityAllowsShift(avail, 1, T(9), T(17))).toBe(true);
  });

  it('blocks when an available window only partially covers the shift', () => {
    const avail = [{ dayIndex: 1, startMinutes: T(8), endMinutes: T(14), available: true }];
    expect(availabilityAllowsShift(avail, 1, T(9), T(17))).toBe(false);
  });

  it('blocks when an unavailable window overlaps even if a covering window exists', () => {
    const avail = [
      { dayIndex: 1, startMinutes: T(8), endMinutes: T(18), available: true },
      { dayIndex: 1, startMinutes: T(12), endMinutes: T(13), available: false },
    ];
    expect(availabilityAllowsShift(avail, 1, T(9), T(17))).toBe(false);
  });

  it('isolates availability per day', () => {
    const avail = [{ dayIndex: 2, startMinutes: T(8), endMinutes: T(18), available: true }];
    // Shift is on day 1, only day-2 data exists → no data for day 1 → allowed.
    expect(availabilityAllowsShift(avail, 1, T(9), T(17))).toBe(true);
  });
});

describe('blocksDoubleBook', () => {
  it('flags an overlapping block on the same day only', () => {
    const blocks = [{ dayIndex: 1, startMinutes: T(9), endMinutes: T(17) }];
    expect(blocksDoubleBook(blocks, 1, T(16), T(20))).toBe(true);
    expect(blocksDoubleBook(blocks, 2, T(16), T(20))).toBe(false);
    expect(blocksDoubleBook(blocks, 1, T(17), T(20))).toBe(false);
  });
});

describe('autoAssignShifts', () => {
  it('assigns an open shift to an available, role-matched staffer', () => {
    const shifts = [shift('s1', 1, T(9), T(17))];
    const people = [staff({ profileId: 'p1', availability: [{ dayIndex: 1, startMinutes: T(8), endMinutes: T(18), available: true }] })];
    const result = autoAssignShifts(shifts, people, { maxWeeklyMinutes: null });
    expect(result.filled).toBe(1);
    expect(result.proposals[0]).toMatchObject({ shiftId: 's1', profileId: 'p1', reason: 'assigned' });
  });

  it('leaves a shift unfilled when no role matches', () => {
    const shifts = [shift('s1', 1, T(9), T(17), 'Bartender')];
    const people = [staff({ profileId: 'p1', role: 'server', jobTitle: 'Server' })];
    const result = autoAssignShifts(shifts, people, { maxWeeklyMinutes: null });
    expect(result.unfilled).toBe(1);
    expect(result.proposals[0]).toMatchObject({ profileId: null, reason: 'no_role_match' });
  });

  it('matches role by profile.role when jobTitle differs', () => {
    const shifts = [shift('s1', 1, T(9), T(17), 'server')];
    const people = [staff({ profileId: 'p1', role: 'server', jobTitle: 'Lead' })];
    const result = autoAssignShifts(shifts, people, { maxWeeklyMinutes: null });
    expect(result.proposals[0]).toMatchObject({ profileId: 'p1', reason: 'assigned' });
  });

  it('does not assign a staffer who is unavailable', () => {
    const shifts = [shift('s1', 1, T(9), T(17))];
    const people = [staff({ profileId: 'p1', availability: [{ dayIndex: 1, startMinutes: T(9), endMinutes: T(17), available: false }] })];
    const result = autoAssignShifts(shifts, people, { maxWeeklyMinutes: null });
    expect(result.proposals[0]).toMatchObject({ profileId: null, reason: 'no_availability' });
  });

  it('prevents double-booking within a single run', () => {
    const shifts = [shift('s1', 1, T(9), T(17)), shift('s2', 1, T(12), T(20))];
    const people = [staff({ profileId: 'p1' })]; // no availability data → both allowed by availability
    const result = autoAssignShifts(shifts, people, { maxWeeklyMinutes: null });
    expect(result.filled).toBe(1);
    const second = result.proposals.find((p) => p.shiftId === 's2');
    expect(second).toMatchObject({ profileId: null, reason: 'all_double_booked' });
  });

  it('respects double-booking against pre-existing assignments', () => {
    const shifts = [shift('s1', 1, T(10), T(16))];
    const people = [staff({ profileId: 'p1', assignedBlocks: [{ dayIndex: 1, startMinutes: T(9), endMinutes: T(17) }], assignedMinutes: T(8) })];
    const result = autoAssignShifts(shifts, people, { maxWeeklyMinutes: null });
    expect(result.proposals[0]).toMatchObject({ profileId: null, reason: 'all_double_booked' });
  });

  it('enforces the weekly labor cap', () => {
    const shifts = [shift('s1', 3, T(9), T(17))]; // 8h = 480m
    const people = [staff({ profileId: 'p1', assignedMinutes: T(36) })]; // already 36h, cap 40h
    const result = autoAssignShifts(shifts, people, { maxWeeklyMinutes: T(40) });
    expect(result.proposals[0]).toMatchObject({ profileId: null, reason: 'labor_cap' });
  });

  it('balances load across eligible staff (lowest-loaded wins)', () => {
    const shifts = [shift('s1', 1, T(9), T(13)), shift('s2', 2, T(9), T(13))];
    const people = [
      staff({ profileId: 'p1', assignedMinutes: T(20) }),
      staff({ profileId: 'p2', assignedMinutes: T(0) }),
    ];
    const result = autoAssignShifts(shifts, people, { maxWeeklyMinutes: null });
    // p2 starts emptier, takes s1; after +4h (240m) p2=240 vs p1=1200 → p2 takes s2 too.
    expect(result.proposals.find((p) => p.shiftId === 's1')?.profileId).toBe('p2');
    expect(result.proposals.find((p) => p.shiftId === 's2')?.profileId).toBe('p2');
  });

  it('is deterministic when load is tied (stable by profileId)', () => {
    const shifts = [shift('s1', 1, T(9), T(13))];
    const people = [staff({ profileId: 'pB' }), staff({ profileId: 'pA' })];
    const result = autoAssignShifts(shifts, people, { maxWeeklyMinutes: null });
    expect(result.proposals[0].profileId).toBe('pA');
  });

  it('fills multiple shifts across staff and reports totals', () => {
    const shifts = [shift('s1', 1, T(9), T(17)), shift('s2', 1, T(9), T(17)), shift('s3', 1, T(9), T(17), 'Bartender')];
    const people = [
      staff({ profileId: 'p1', jobTitle: 'Server' }),
      staff({ profileId: 'p2', jobTitle: 'Server' }),
    ];
    const result = autoAssignShifts(shifts, people, { maxWeeklyMinutes: null });
    expect(result.filled).toBe(2); // two servers fill s1,s2; s3 (bartender) unfilled
    expect(result.unfilled).toBe(1);
  });
});
