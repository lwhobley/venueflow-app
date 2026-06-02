// Pure auto-schedule engine. No Convex imports so it is unit-testable in
// isolation and reusable from mutations/queries. Convex handlers load rows,
// map them into these plain shapes, call the engine, then persist or preview.

export type EngineAvailability = {
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
  available: boolean;
};

export type EngineBlock = {
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
};

export type EngineStaff = {
  profileId: string;
  role: string;
  jobTitle: string;
  availability: EngineAvailability[];
  // Minutes already committed this week from existing assigned shifts.
  assignedMinutes: number;
  // Existing assigned shifts, used for double-booking detection.
  assignedBlocks: EngineBlock[];
  // Day indexes (0=Sun..6=Sat) the staffer has approved time off for this
  // week. Computed from calendar-date time-off against the week anchor.
  blockedDays?: number[];
};

export type EngineOpenShift = {
  shiftId: string;
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
  jobTitle: string;
};

export type EngineConstraints = {
  maxWeeklyMinutes: number | null;
};

export type EngineProposal = {
  shiftId: string;
  profileId: string | null;
  reason: 'assigned' | 'no_role_match' | 'no_availability' | 'all_double_booked' | 'labor_cap' | 'time_off';
};

export type EngineResult = {
  proposals: EngineProposal[];
  filled: number;
  unfilled: number;
};

export function timeRangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

const isoDateRe = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Adds `days` to a YYYY-MM-DD date (UTC math) and returns YYYY-MM-DD.
export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

// Given the week's anchor (the Sunday, YYYY-MM-DD) and an inclusive time-off
// range, returns the day indexes (0=Sun..6=Sat) that fall inside the range.
// YYYY-MM-DD strings order lexicographically as dates, so the comparison is a
// plain string compare.
export function blockedDayIndexes(weekStart: string, rangeStart: string, rangeEnd: string): number[] {
  if (!isoDateRe.test(weekStart) || !isoDateRe.test(rangeStart) || !isoDateRe.test(rangeEnd)) return [];
  const lo = rangeStart <= rangeEnd ? rangeStart : rangeEnd;
  const hi = rangeStart <= rangeEnd ? rangeEnd : rangeStart;
  const out: number[] = [];
  for (let i = 0; i < 7; i += 1) {
    const date = addDaysISO(weekStart, i);
    if (date >= lo && date <= hi) out.push(i);
  }
  return out;
}

function sameMinute(a: number, b: number): boolean {
  return a === b;
}

// Mirrors the conflict semantics used across the schedule: a member with
// availability data for a day is eligible only when no unavailable window
// overlaps the shift and at least one available window fully covers it. With no
// data for that day we cannot determine intent, so we do not block.
export function availabilityAllowsShift(
  avail: EngineAvailability[],
  dayIndex: number,
  start: number,
  end: number,
): boolean {
  const dayRows = avail.filter((a) => a.dayIndex === dayIndex);
  if (dayRows.length === 0) return true;
  const blocked = dayRows.some((a) => !a.available && timeRangesOverlap(a.startMinutes, a.endMinutes, start, end));
  if (blocked) return false;
  return dayRows.some((a) => a.available && a.startMinutes <= start && a.endMinutes >= end);
}

export function blocksDoubleBook(blocks: EngineBlock[], dayIndex: number, start: number, end: number): boolean {
  return blocks.some((b) => b.dayIndex === dayIndex && timeRangesOverlap(b.startMinutes, b.endMinutes, start, end));
}

function roleMatches(staff: EngineStaff, shift: EngineOpenShift): boolean {
  const want = shift.jobTitle.trim().toLowerCase();
  if (!want) return true;
  return staff.jobTitle.trim().toLowerCase() === want || staff.role.trim().toLowerCase() === want;
}

// Greedy assignment with load balancing: open shifts are filled earliest-first,
// each going to the eligible, lowest-loaded staffer. Running tallies of minutes
// and assigned blocks are mutated so later shifts respect prior picks in the
// same run (no double-booking, labor cap honored across the batch).
export function autoAssignShifts(
  openShifts: EngineOpenShift[],
  staff: EngineStaff[],
  constraints: EngineConstraints,
): EngineResult {
  const minutes = new Map<string, number>();
  const blocks = new Map<string, EngineBlock[]>();
  for (const member of staff) {
    minutes.set(member.profileId, member.assignedMinutes);
    blocks.set(member.profileId, [...member.assignedBlocks]);
  }

  const ordered = [...openShifts].sort(
    (a, b) => a.dayIndex - b.dayIndex || a.startMinutes - b.startMinutes || a.shiftId.localeCompare(b.shiftId),
  );

  const proposals: EngineProposal[] = [];
  let filled = 0;

  for (const shift of ordered) {
    const length = Math.max(0, shift.endMinutes - shift.startMinutes);

    const roleEligible = staff.filter((s) => roleMatches(s, shift));
    if (roleEligible.length === 0) {
      proposals.push({ shiftId: shift.shiftId, profileId: null, reason: 'no_role_match' });
      continue;
    }

    const offDuty = roleEligible.filter((s) => !(s.blockedDays ?? []).includes(shift.dayIndex));
    if (offDuty.length === 0) {
      proposals.push({ shiftId: shift.shiftId, profileId: null, reason: 'time_off' });
      continue;
    }

    const availEligible = offDuty.filter((s) =>
      availabilityAllowsShift(s.availability, shift.dayIndex, shift.startMinutes, shift.endMinutes),
    );
    if (availEligible.length === 0) {
      proposals.push({ shiftId: shift.shiftId, profileId: null, reason: 'no_availability' });
      continue;
    }

    const freeOfConflict = availEligible.filter(
      (s) => !blocksDoubleBook(blocks.get(s.profileId) ?? [], shift.dayIndex, shift.startMinutes, shift.endMinutes),
    );
    if (freeOfConflict.length === 0) {
      proposals.push({ shiftId: shift.shiftId, profileId: null, reason: 'all_double_booked' });
      continue;
    }

    const underCap =
      constraints.maxWeeklyMinutes == null
        ? freeOfConflict
        : freeOfConflict.filter((s) => (minutes.get(s.profileId) ?? 0) + length <= constraints.maxWeeklyMinutes!);
    if (underCap.length === 0) {
      proposals.push({ shiftId: shift.shiftId, profileId: null, reason: 'labor_cap' });
      continue;
    }

    const pick = underCap
      .slice()
      .sort((a, b) => {
        const am = minutes.get(a.profileId) ?? 0;
        const bm = minutes.get(b.profileId) ?? 0;
        if (!sameMinute(am, bm)) return am - bm;
        return a.profileId.localeCompare(b.profileId);
      })[0];

    minutes.set(pick.profileId, (minutes.get(pick.profileId) ?? 0) + length);
    const pickBlocks = blocks.get(pick.profileId) ?? [];
    pickBlocks.push({ dayIndex: shift.dayIndex, startMinutes: shift.startMinutes, endMinutes: shift.endMinutes });
    blocks.set(pick.profileId, pickBlocks);

    proposals.push({ shiftId: shift.shiftId, profileId: pick.profileId, reason: 'assigned' });
    filled += 1;
  }

  return { proposals, filled, unfilled: proposals.length - filled };
}
