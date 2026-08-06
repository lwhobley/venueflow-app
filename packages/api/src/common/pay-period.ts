// Pay-period and availability-lock math.
//
// All dates are 'YYYY-MM-DD' strings computed in UTC so boundaries don't drift
// with server timezone. A pay period is `lengthDays` long, repeating from a
// manager-set anchor date. Availability for a week is editable until that
// week's pay period begins (its period start is on/before today); after that
// it's locked unless a manager unlocks availability venue-wide.

const DAY_MS = 24 * 60 * 60 * 1000;

// A Sunday, so default Sunday-aligned weeks line up with 14-day periods.
export const DEFAULT_PAY_PERIOD_ANCHOR = '2024-01-07';
export const DEFAULT_PAY_PERIOD_LENGTH_DAYS = 14;
// Pay periods are whole weeks (1–4) so period boundaries align to Sunday week
// boundaries used by payroll and concrete weekly schedules.
export const MIN_PAY_PERIOD_LENGTH_DAYS = 7;
export const MAX_PAY_PERIOD_LENGTH_DAYS = 28;

export function isValidPeriodLength(lengthDays: number): boolean {
  return (
    Number.isInteger(lengthDays) &&
    lengthDays % 7 === 0 &&
    lengthDays >= MIN_PAY_PERIOD_LENGTH_DAYS &&
    lengthDays <= MAX_PAY_PERIOD_LENGTH_DAYS
  );
}

export function toUtcMs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function fromUtcMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return fromUtcMs(toUtcMs(value)) === value;
}

export function addDays(dateStr: string, days: number): string {
  return fromUtcMs(toUtcMs(dateStr) + days * DAY_MS);
}

/** The Sunday that starts the week containing dateStr. */
export function weekStartFor(dateStr: string): string {
  const ms = toUtcMs(dateStr);
  const dow = new Date(ms).getUTCDay();
  return fromUtcMs(ms - dow * DAY_MS);
}

export function todayIso(now: Date = new Date()): string {
  return fromUtcMs(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Today's calendar date in the venue's IANA timezone, so the lock flips at the
 * venue's local midnight rather than UTC midnight. Falls back to UTC when no
 * timezone is set or the zone is invalid.
 */
export function todayInZone(timezone: string | null | undefined, now: Date = new Date()): string {
  if (!timezone) return todayIso(now);
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(now).map((part) => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return todayIso(now);
  }
}

/** Start date of the pay period that contains dateStr. */
export function payPeriodStartFor(dateStr: string, anchor: string, lengthDays: number): string {
  const len = Math.max(1, lengthDays);
  const diffDays = Math.floor((toUtcMs(dateStr) - toUtcMs(anchor)) / DAY_MS);
  const periodIndex = Math.floor(diffDays / len);
  return addDays(anchor, periodIndex * len);
}

/**
 * A week is locked once the pay period containing it has begun (its period
 * start is on/before today). A venue-wide unlock overrides this.
 */
export function isWeekLocked(args: {
  weekStart: string;
  today: string;
  anchor: string;
  lengthDays: number;
  unlocked: boolean;
}): boolean {
  if (args.unlocked) return false;
  const periodStart = payPeriodStartFor(args.weekStart, args.anchor, args.lengthDays);
  return toUtcMs(periodStart) <= toUtcMs(args.today);
}

/** The next `count` Sunday week-starts, beginning with the current week. */
export function upcomingWeeks(today: string, count: number): string[] {
  const start = weekStartFor(today);
  return Array.from({ length: count }, (_, i) => addDays(start, i * 7));
}

/**
 * Weeks of availability to surface: enough to cover the current (locked) period
 * plus the next (editable) period, so there is always an editable week
 * regardless of period length.
 */
export function weeksToCover(lengthDays: number): number {
  return Math.ceil(Math.max(7, lengthDays) / 7) * 2;
}
