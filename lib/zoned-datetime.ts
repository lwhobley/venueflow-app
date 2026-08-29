/** Parse a venue-local YYYY-MM-DD + HH:mm into epoch ms. */
export function zonedDateTimeMs(date: string, time: string, timeZone?: string | null): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return NaN;
  const [hours, minutes] = time.split(':').map(Number);
  if (!timeZone) return new Date(`${date}T${time}:00`).getTime();
  try {
    const utcGuess = Date.parse(`${date}T${time}:00Z`);
    if (!Number.isFinite(utcGuess)) return NaN;
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const asUtcWall = (ms: number) => {
      const parts = Object.fromEntries(
        dtf.formatToParts(new Date(ms)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
      );
      return Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour) % 24,
        Number(parts.minute),
        Number(parts.second),
      );
    };
    // A single correction pass picks the UTC offset in effect at `utcGuess`
    // itself, not at the instant the target wall-clock time actually falls
    // on. Those differ exactly on a DST transition day for any wall-clock
    // time after the transition: e.g. "2026-03-08 06:00 America/New_York" is
    // EDT (UTC-4), but utcGuess (06:00 treated as UTC) is still before the
    // 07:00 UTC transition instant, so the one-shot correction reads back
    // EST (UTC-5) and returns an instant an hour early. Iterating converges:
    // each pass re-evaluates the offset at the newest candidate instant,
    // and a zone has only two possible offsets, so two corrections beyond
    // the initial guess always suffice.
    let candidate = utcGuess;
    for (let i = 0; i < 3; i += 1) {
      const wallAtCandidate = asUtcWall(candidate);
      const diff = wallAtCandidate - utcGuess;
      if (diff === 0) break;
      candidate -= diff;
    }
    return candidate;
  } catch {
    return new Date(`${date}T${time}:00`).getTime();
  }
}

/** The venue-local calendar date (YYYY-MM-DD) of the given instant. */
export function zonedIsoDate(timeZone: string | null | undefined, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

export function zonedDayIndex(timeZone: string | null | undefined, at: Date = new Date()): number {
  try {
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || undefined,
      weekday: 'short',
    }).format(at);
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
  } catch {
    return at.getDay();
  }
}

/**
 * The Sunday-Saturday week containing `at`, in the venue's own calendar —
 * as 7 UTC-midnight-anchored Date objects representing date-only values
 * (never real instants). Read these back with UTC getters/timeZone: 'UTC'
 * formatting, never toLocaleDateString()'s device-local default: mixing a
 * venue-local weekday index with `Date.setDate()` (device-local calendar
 * arithmetic) previously desynced the two near a device/venue midnight
 * boundary, and even a correctly-computed date silently redrifted back to
 * the device's calendar the moment it was formatted for display.
 */
export function zonedWeekDates(timeZone: string | null | undefined, at: Date = new Date()): Date[] {
  const todayIso = zonedIsoDate(timeZone, at);
  const [year, month, day] = todayIso.split('-').map(Number);
  const todayIndex = zonedDayIndex(timeZone, at);
  const sundayUtcMs = Date.UTC(year, month - 1, day - todayIndex);
  return Array.from({ length: 7 }, (_, i) => new Date(sundayUtcMs + i * 24 * 60 * 60 * 1000));
}

export function zonedMinutesNow(timeZone: string | null | undefined, at: Date = new Date()): number {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: timeZone || undefined,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(at).map((part) => [part.type, part.value]),
    );
    return (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  } catch {
    return at.getHours() * 60 + at.getMinutes();
  }
}

/** The calendar date (YYYY-MM-DD) one day after `date`, ignoring time zone —
 * pure calendar arithmetic, not a real-time offset. */
function nextCalendarDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

export function overnightAwareRange(date: string, startTime: string, endTime: string, timeZone?: string | null): { start: number; end: number } {
  const start = zonedDateTimeMs(date, startTime, timeZone);
  let end = zonedDateTimeMs(date, endTime, timeZone);
  if (Number.isFinite(start) && Number.isFinite(end) && end <= start) {
    // Regression for VW-22: adding a flat 24h assumed every local day is
    // exactly 24 real hours, which is false on a DST transition day (23h in
    // spring, 25h in fall). Re-resolving against the actual next calendar
    // date gets the correct wall-clock instant regardless.
    end = zonedDateTimeMs(nextCalendarDate(date), endTime, timeZone);
  }
  return { start, end };
}
