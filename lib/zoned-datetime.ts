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
    return utcGuess - (asUtcWall(utcGuess) - utcGuess);
  } catch {
    return new Date(`${date}T${time}:00`).getTime();
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

export function overnightAwareRange(date: string, startTime: string, endTime: string, timeZone?: string | null): { start: number; end: number } {
  const start = zonedDateTimeMs(date, startTime, timeZone);
  let end = zonedDateTimeMs(date, endTime, timeZone);
  if (Number.isFinite(start) && Number.isFinite(end) && end <= start) {
    end += 24 * 60 * 60 * 1000;
  }
  return { start, end };
}
