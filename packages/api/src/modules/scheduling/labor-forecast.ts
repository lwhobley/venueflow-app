import { dayLabel } from '../../common/mappers';
import { occupiedSlots } from '../../common/shift-overlap';
import { normalizedShiftEnd, zonedDayOfWeek, zonedMinutesOfDay } from '../../common/venue-time';

// Dayparts are venue-local minute windows. `late` wraps past midnight
// (10pm–2am), so endMin < startMin; the matchers below handle the wrap. Without
// it, post-midnight covers (minute-of-day < startMin) and the 1440–1560 slice
// would silently fall into no bucket.
export const DAYPARTS = [
  { key: 'am', label: 'AM', startMin: 360, endMin: 660 },
  { key: 'lunch', label: 'Lunch', startMin: 660, endMin: 840 },
  { key: 'dinner', label: 'Dinner', startMin: 1020, endMin: 1320 },
  { key: 'late', label: 'Late', startMin: 1320, endMin: 120 },
] as const;

type DaypartWindow = { startMin: number; endMin: number };

/** A minute-of-day (0–1439) falls inside a daypart, accounting for wrap. */
export function minuteInDaypart(mod: number, dp: DaypartWindow): boolean {
  return dp.startMin <= dp.endMin
    ? mod >= dp.startMin && mod < dp.endMin
    : mod >= dp.startMin || mod < dp.endMin;
}

/** A shift window [start, end) overlaps a daypart, accounting for wrap. */
export function shiftOverlapsDaypart(start: number, end: number, dp: DaypartWindow): boolean {
  return dp.startMin <= dp.endMin
    ? start < dp.endMin && end > dp.startMin
    : end > dp.startMin || start < dp.endMin;
}

export type ForecastShift = {
  weekStart?: string | null;
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
  profileId: string | null;
};
export type ForecastReservation = { ts: number; partySize: number; isPrivateEvent: boolean };
export type ForecastEvent = { ts: number; expectedGuests: number | null };

export type ForecastInput = {
  tz: string | null;
  now: Date;
  weekStart?: string;
  shifts: ForecastShift[];
  reservations: ForecastReservation[];
  events: ForecastEvent[];
  nameById: Map<string, string>;
};

export type ForecastDaypart = { key: string; label: string; covers: number; scheduledPeople: number };
export type ForecastDay = {
  dayIndex: number;
  dayLabel: string;
  covers: number;
  privateEvents: number;
  scheduledPeople: number;
  scheduledHours: number;
  suggestedHours: number;
  gapHours: number;
  status: 'under' | 'over' | 'balanced';
  dayparts: ForecastDaypart[];
};
export type ForecastAlert = { kind: string; severity: 'warning' | 'critical'; message: string; dayLabel?: string };
export type ForecastOtRisk = { name: string; scheduledHours: number; overLimit: boolean };
export type LaborForecast = {
  days: ForecastDay[];
  totals: { covers: number; scheduledHours: number; suggestedHours: number; gapHours: number };
  alerts: ForecastAlert[];
  otRisk: ForecastOtRisk[];
};

const round1 = (n: number) => Math.round(n * 10) / 10;

// Staffing heuristics. Kept as named constants so the thresholds the alerts and
// OT watch key off are visible in one place.
const COVERS_PER_LABOR_HOUR = 8; // 1 labor hour covers ~8 guests
const PRIVATE_EVENT_HOURS = 6; // each private event adds a fixed labor block
const UNDERSTAFFED_GAP = 4; // gap (suggested − scheduled) above this = understaffed
const OVERSTAFFED_GAP = -6; // gap below this = overstaffed
const OT_WATCH_MINUTES = 32 * 60; // surface staff at/above this weekly
const OT_LIMIT_MINUTES = 40 * 60; // past this = overtime violation
const BREAK_REQUIRED_MINUTES = 6 * 60; // many states require a paid/unpaid meal break past a 6h shift
const REST_BETWEEN_SHIFTS_MINUTES = 10 * 60; // "clopening" risk: close-then-open with under 10h off

/**
 * Pure labor-forecast aggregation. Deterministic given `now`; all time-zone math
 * goes through the (already-tested) venue-time helpers. Extracted from the
 * controller so the staffing logic can be unit-tested without a database.
 */
export function buildLaborForecast(input: ForecastInput): LaborForecast {
  const { tz, now, shifts, reservations, events, nameById } = input;
  const forecastWeekStart = input.weekStart ?? null;

  const scheduledByDay = new Map<number, { minutes: number; people: Set<string> }>();
  const weeklyMinutes = new Map<string, number>();
  const daypartStaff = new Map<number, Map<string, Set<string>>>();

  for (const shift of shifts) {
    // Only allocate hours that land inside the selected calendar week. This
    // admits the post-midnight slice of the prior Saturday while excluding the
    // next-week slice of the selected Saturday.
    const slots = occupiedSlots(shift).filter((slot) =>
      !forecastWeekStart || !slot.weekStart || slot.weekStart === forecastWeekStart,
    );
    for (const slot of slots) {
      const minutes = Math.max(0, slot.end - slot.start);
      const row = scheduledByDay.get(slot.dayIndex) ?? { minutes: 0, people: new Set<string>() };
      row.minutes += minutes;
      if (shift.profileId) {
        row.people.add(shift.profileId);
        weeklyMinutes.set(shift.profileId, (weeklyMinutes.get(shift.profileId) ?? 0) + minutes);
      }
      scheduledByDay.set(slot.dayIndex, row);

      const dpMap = daypartStaff.get(slot.dayIndex) ?? new Map<string, Set<string>>();
      for (const dp of DAYPARTS) {
        if (shiftOverlapsDaypart(slot.start, slot.end, dp)) {
          const s = dpMap.get(dp.key) ?? new Set<string>();
          if (shift.profileId) s.add(shift.profileId);
          dpMap.set(dp.key, s);
        }
      }
      daypartStaff.set(slot.dayIndex, dpMap);
    }
  }

  const demandByDay = new Map<number, { covers: number; privateEvents: number }>();
  const daypartCovers = new Map<number, Map<string, number>>();

  const addDemand = (ts: number, covers: number, isPrivateEvent: boolean) => {
    const dayIndex = zonedDayOfWeek(tz, ts);
    const row = demandByDay.get(dayIndex) ?? { covers: 0, privateEvents: 0 };
    row.covers += covers;
    if (isPrivateEvent) row.privateEvents += 1;
    demandByDay.set(dayIndex, row);

    const mod = zonedMinutesOfDay(tz, ts);
    const dpMap = daypartCovers.get(dayIndex) ?? new Map<string, number>();
    for (const dp of DAYPARTS) {
      if (minuteInDaypart(mod, dp)) {
        dpMap.set(dp.key, (dpMap.get(dp.key) ?? 0) + covers);
        break;
      }
    }
    daypartCovers.set(dayIndex, dpMap);
  };

  for (const reservation of reservations) {
    addDemand(reservation.ts, reservation.partySize, reservation.isPrivateEvent);
  }
  for (const event of events) {
    addDemand(event.ts, event.expectedGuests ?? 0, true);
  }

  // Predictive compliance checks — flagged before the shift happens, not after,
  // so a manager can fix the schedule instead of discovering a violation later.
  const complianceAlerts: ForecastAlert[] = [];

  // One alert per person (not per shift) — a manager with several long shifts
  // this week doesn't need a separate line for each one, just a heads-up.
  const longShiftsByProfile = new Map<string, number>();
  let unassignedLongShifts = 0;
  for (const shift of shifts) {
    if (forecastWeekStart && shift.weekStart && shift.weekStart !== forecastWeekStart) continue;
    const durationMinutes = shift.endMinutes - shift.startMinutes;
    if (durationMinutes < BREAK_REQUIRED_MINUTES) continue;
    if (shift.profileId) {
      longShiftsByProfile.set(shift.profileId, (longShiftsByProfile.get(shift.profileId) ?? 0) + 1);
    } else {
      unassignedLongShifts += 1;
    }
  }
  for (const [profileId, count] of longShiftsByProfile) {
    const name = nameById.get(profileId) ?? 'Staff member';
    complianceAlerts.push({
      kind: 'break_reminder',
      severity: 'warning',
      message: `${name} has ${count} shift${count === 1 ? '' : 's'} of ${BREAK_REQUIRED_MINUTES / 60}h+ this week — make sure breaks are logged.`,
    });
  }
  if (unassignedLongShifts > 0) {
    complianceAlerts.push({
      kind: 'break_reminder',
      severity: 'warning',
      message: `${unassignedLongShifts} open shift${unassignedLongShifts === 1 ? '' : 's'} this week ${unassignedLongShifts === 1 ? 'is' : 'are'} ${BREAK_REQUIRED_MINUTES / 60}h+ — whoever picks it up will need a break logged.`,
    });
  }

  const shiftsByProfile = new Map<string, ForecastShift[]>();
  for (const shift of shifts) {
    if (!shift.profileId) continue;
    const rows = shiftsByProfile.get(shift.profileId) ?? [];
    rows.push(shift);
    shiftsByProfile.set(shift.profileId, rows);
  }
  for (const [profileId, profileShifts] of shiftsByProfile) {
    const windows = profileShifts
      .map((shift) => absoluteShiftWindow(shift, forecastWeekStart))
      .filter((window): window is NonNullable<typeof window> => window !== null)
      .sort((a, b) => a.start - b.start);
    for (let index = 0; index < windows.length - 1; index += 1) {
      const current = windows[index];
      const next = windows[index + 1];
      const restMinutes = next.start - current.end;
      const startsOnLaterDay = Math.floor(next.start / 1440) > Math.floor(current.start / 1440);
      if (startsOnLaterDay && restMinutes >= 0 && restMinutes < REST_BETWEEN_SHIFTS_MINUTES) {
        const name = nameById.get(profileId) ?? 'Staff member';
        complianceAlerts.push({
          kind: 'clopening_risk',
          severity: 'critical',
          message: `${name} closes ${dayLabel(current.dayIndex)} and opens ${dayLabel(next.dayIndex)} with only ${round1(restMinutes / 60)}h off — under the ${REST_BETWEEN_SHIFTS_MINUTES / 60}h rest guideline.`,
          dayLabel: dayLabel(next.dayIndex),
        });
      }
    }
  }

  const otRisk: ForecastOtRisk[] = Array.from(weeklyMinutes.entries())
    .filter(([, mins]) => mins >= OT_WATCH_MINUTES)
    .map(([profileId, mins]) => ({
      name: nameById.get(profileId) ?? 'Staff member',
      scheduledHours: round1(mins / 60),
      overLimit: mins > OT_LIMIT_MINUTES,
    }))
    .sort((a, b) => b.scheduledHours - a.scheduledHours);

  const days: ForecastDay[] = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(now);
    date.setDate(now.getDate() + offset);
    const dayIndex = zonedDayOfWeek(tz, date.getTime());
    const scheduled = scheduledByDay.get(dayIndex);
    const demand = demandByDay.get(dayIndex) ?? { covers: 0, privateEvents: 0 };
    const scheduledHours = round1((scheduled?.minutes ?? 0) / 60);
    const suggestedHours = Math.max(0, round1(demand.covers / COVERS_PER_LABOR_HOUR + demand.privateEvents * PRIVATE_EVENT_HOURS));
    const gapHours = round1(suggestedHours - scheduledHours);

    const dpCoverMap = daypartCovers.get(dayIndex) ?? new Map<string, number>();
    const dpStaffMap = daypartStaff.get(dayIndex) ?? new Map<string, Set<string>>();
    const dayparts = DAYPARTS.map((dp) => ({
      key: dp.key,
      label: dp.label,
      covers: dpCoverMap.get(dp.key) ?? 0,
      scheduledPeople: dpStaffMap.get(dp.key)?.size ?? 0,
    })).filter((dp) => dp.covers > 0 || dp.scheduledPeople > 0);

    return {
      dayIndex,
      dayLabel: dayLabel(dayIndex),
      covers: demand.covers,
      privateEvents: demand.privateEvents,
      scheduledPeople: scheduled?.people.size ?? 0,
      scheduledHours,
      suggestedHours,
      gapHours,
      status: gapHours > UNDERSTAFFED_GAP ? 'under' : gapHours < OVERSTAFFED_GAP ? 'over' : 'balanced',
      dayparts,
    };
  });

  const alerts: ForecastAlert[] = [];
  for (const day of days) {
    if (day.status === 'under') {
      const extra = Math.ceil(day.gapHours / PRIVATE_EVENT_HOURS);
      alerts.push({
        kind: 'understaffed',
        severity: day.gapHours > 8 ? 'critical' : 'warning',
        message: `${day.dayLabel}: ${day.gapHours}h understaffed — add ${extra} staff member${extra === 1 ? '' : 's'}`,
        dayLabel: day.dayLabel,
      });
    } else if (day.status === 'over') {
      const early = Math.floor(Math.abs(day.gapHours) / PRIVATE_EVENT_HOURS);
      if (early > 0) {
        alerts.push({
          kind: 'overstaffed',
          severity: 'warning',
          message: `${day.dayLabel}: ${Math.abs(day.gapHours)}h overstaffed — consider releasing ${early} staff early`,
          dayLabel: day.dayLabel,
        });
      }
    }
  }
  for (const risk of otRisk) {
    alerts.push({
      kind: risk.overLimit ? 'ot_violation' : 'ot_risk',
      severity: risk.overLimit ? 'critical' : 'warning',
      message: risk.overLimit
        ? `${risk.name} is over 40h (${risk.scheduledHours}h scheduled)`
        : `${risk.name} approaching OT (${risk.scheduledHours}h scheduled)`,
    });
  }
  alerts.push(...complianceAlerts);

  const totalCovers = days.reduce((sum, day) => sum + day.covers, 0);
  const totalScheduledHours = round1(days.reduce((sum, day) => sum + day.scheduledHours, 0));
  const totalSuggestedHours = round1(days.reduce((sum, day) => sum + day.suggestedHours, 0));

  return {
    days,
    totals: {
      covers: totalCovers,
      scheduledHours: totalScheduledHours,
      suggestedHours: totalSuggestedHours,
      gapHours: round1(totalSuggestedHours - totalScheduledHours),
    },
    alerts,
    otRisk,
  };
}

function absoluteShiftWindow(shift: ForecastShift, defaultWeekStart: string | null) {
  const weekStart = shift.weekStart ?? defaultWeekStart;
  if (!weekStart) {
    return {
      start: shift.dayIndex * 1440 + shift.startMinutes,
      end: shift.dayIndex * 1440 + normalizedShiftEnd(shift.startMinutes, shift.endMinutes),
      dayIndex: shift.dayIndex,
    };
  }
  const epoch = Date.parse(`${weekStart}T00:00:00.000Z`);
  if (!Number.isFinite(epoch)) return null;
  const weekMinutes = epoch / 60_000;
  return {
    start: weekMinutes + shift.dayIndex * 1440 + shift.startMinutes,
    end: weekMinutes + shift.dayIndex * 1440 + normalizedShiftEnd(shift.startMinutes, shift.endMinutes),
    dayIndex: shift.dayIndex,
  };
}
