import { minutesToTime } from './mappers';
import { addDays, todayInZone, weekStartFor } from './pay-period';
import { isWithinShiftWindow, normalizedShiftEnd, zonedDayOfWeek, zonedMinutesOfDay } from './venue-time';

/**
 * Late/missed clock alerts, shared by the manager clock board
 * (time-clock.controller getClockBoard) and the Reports KPI tile
 * (app.controller getManagerInsights).
 *
 * Both surfaces must agree on what counts as an alert — a board showing three
 * alerts next to a tile reading "1" is worse than showing neither — so the rule
 * lives here once instead of being reimplemented per caller.
 */

/** Grace period before a scheduled-but-not-clocked-in member is flagged. */
export const LATE_CLOCK_IN_GRACE_MINUTES = 15;

/** An open punch older than this is treated as a forgotten clock-out. */
export const MISSED_CLOCK_OUT_MS = 10 * 60 * 60 * 1000;

export type ClockAlert = {
  kind: 'late_clock_in' | 'missed_clock_out' | 'location_anomaly';
  severity: 'warning' | 'danger';
  profileId: string;
  memberName: string;
  detail: string;
};

export type ClockAlertShift = {
  weekStart: string | null;
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
  status: string;
  jobTitle: string;
  profileId: string | null;
  profile: { id: string; fullName: string } | null;
};

export type ClockAlertEntry = {
  isOpen: boolean;
  clockInAt: Date;
  profileId: string | null;
  profile: { id: string; fullName: string } | null;
  /** Set when the punch reused an earlier day's exact coordinates. */
  locationAnomaly?: string | null;
};

/**
 * The (weekStart, dayIndex) pairs a shift must match to be alert-eligible:
 * today, plus yesterday for shifts that run past midnight. Callers pass this
 * straight into a Prisma `OR` so the query and the filter below stay in step.
 */
export function clockAlertShiftWindow(timezone: string | null | undefined, nowMs: number) {
  const today = zonedDayOfWeek(timezone, nowMs);
  const todayDate = todayInZone(timezone);
  const weekStart = weekStartFor(todayDate);
  const yesterdayWeekStart = weekStartFor(addDays(todayDate, -1));
  const yesterday = (today + 6) % 7;
  return {
    today,
    weekStart,
    yesterday,
    yesterdayWeekStart,
    where: [
      { weekStart, dayIndex: today },
      { weekStart: yesterdayWeekStart, dayIndex: yesterday },
    ],
  };
}

/**
 * Build the alert list for a venue. Pure: every input is already loaded, so the
 * rule is unit-testable without a database.
 */
export function buildClockAlerts(input: {
  timezone: string | null | undefined;
  nowMs: number;
  shifts: ClockAlertShift[];
  entries: ClockAlertEntry[];
}): ClockAlert[] {
  const { timezone, nowMs, shifts, entries } = input;
  const alerts: ClockAlert[] = [];
  const window = clockAlertShiftWindow(timezone, nowMs);
  const minutesNow = zonedMinutesOfDay(timezone, nowMs);
  const openByProfile = new Set(
    entries.filter((entry) => entry.isOpen).map((entry) => entry.profileId),
  );

  for (const shift of shifts) {
    const isToday = shift.weekStart === window.weekStart && shift.dayIndex === window.today;
    const isOvernightYesterday = shift.weekStart === window.yesterdayWeekStart
      && shift.dayIndex === window.yesterday
      && normalizedShiftEnd(shift.startMinutes, shift.endMinutes) > 1440;
    if ((!isToday && !isOvernightYesterday) || !shift.profileId || shift.status === 'open') continue;
    if (
      isWithinShiftWindow(minutesNow, shift.startMinutes + LATE_CLOCK_IN_GRACE_MINUTES, shift.endMinutes) &&
      !openByProfile.has(shift.profileId) &&
      shift.profile
    ) {
      alerts.push({
        kind: 'late_clock_in',
        severity: 'warning',
        profileId: shift.profile.id,
        memberName: shift.profile.fullName,
        detail: `${shift.jobTitle} was scheduled at ${minutesToTime(shift.startMinutes)} and is not clocked in.`,
      });
    }
  }

  for (const entry of entries) {
    if (!entry.isOpen || nowMs - entry.clockInAt.getTime() < MISSED_CLOCK_OUT_MS) continue;
    if (entry.profile) {
      alerts.push({
        kind: 'missed_clock_out',
        severity: 'danger',
        profileId: entry.profile.id,
        memberName: entry.profile.fullName,
        detail: `Clocked in since ${entry.clockInAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone || 'UTC' })}.`,
      });
    }
  }

  // A punch whose coordinates exactly repeated an earlier day's is no longer
  // refused outright (indoor Wi-Fi positioning does that legitimately), so the
  // manager is told instead and decides whether it needs following up.
  for (const entry of entries) {
    if (!entry.locationAnomaly || !entry.profile) continue;
    alerts.push({
      kind: 'location_anomaly',
      severity: 'warning',
      profileId: entry.profile.id,
      memberName: entry.profile.fullName,
      detail: 'This punch reported the same location as an earlier day. Common indoors, but worth a look if it repeats.',
    });
  }

  return alerts;
}
