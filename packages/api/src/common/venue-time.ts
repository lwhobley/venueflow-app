// Venue-local time helpers. Venues report against their own business day, not
// the server's (UTC on Railway). All helpers fall back to UTC when the venue
// has no timezone configured, preserving the previous behavior.

const FALLBACK_TZ = 'UTC';

function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return FALLBACK_TZ;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return FALLBACK_TZ;
  }
}

// Milliseconds the zone is ahead of UTC at the given instant (DST-aware).
function tzOffsetMs(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
  const wallClockAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return wallClockAsUtc - at.getTime();
}

/** The venue-local day-of-week (0 = Sunday … 6 = Saturday) at the given instant. */
export function zonedDayOfWeek(timeZone: string | null | undefined, ts: number): number {
  const tz = safeTimeZone(timeZone);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).formatToParts(new Date(ts)).map((p) => [p.type, p.value]),
  );
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[parts.weekday] ?? new Date(ts).getUTCDay();
}

/** The venue-local calendar date (YYYY-MM-DD) of the given instant. */
export function zonedIsoDate(timeZone: string | null | undefined, ts: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ts));
}

/**
 * UTC instant range [start, end) of a venue-local calendar day, offset from
 * the venue's "today" by offsetDays. DST-safe (end is the next day's start).
 */
export function zonedDayBounds(
  timeZone: string | null | undefined,
  offsetDays: number,
): { start: number; end: number } {
  const tz = safeTimeZone(timeZone);
  const todayIso = zonedIsoDate(tz, Date.now());
  const [y, m, d] = todayIso.split('-').map(Number);
  const startUtcGuess = Date.UTC(y, m - 1, d + offsetDays);
  const start = startUtcGuess - tzOffsetMs(tz, new Date(startUtcGuess - tzOffsetMs(tz, new Date(startUtcGuess))));
  const endUtcGuess = Date.UTC(y, m - 1, d + offsetDays + 1);
  const end = endUtcGuess - tzOffsetMs(tz, new Date(endUtcGuess - tzOffsetMs(tz, new Date(endUtcGuess))));
  return { start, end };
}
