import { describe, expect, it } from 'vitest';
import {
  buildLaborForecast,
  minuteInDaypart,
  shiftOverlapsDaypart,
  type ForecastInput,
} from './labor-forecast';

const LATE = { startMin: 1320, endMin: 120 }; // 10pm–2am, wraps midnight
const DINNER = { startMin: 1020, endMin: 1320 }; // 5pm–10pm, no wrap

// A fixed Sunday so day-offset math is deterministic. UTC tz keeps
// minute-of-day equal to the UTC clock, so test timestamps are easy to reason about.
const SUNDAY = new Date('2024-01-07T12:00:00.000Z');

function baseInput(overrides: Partial<ForecastInput> = {}): ForecastInput {
  return {
    tz: 'UTC',
    now: SUNDAY,
    shifts: [],
    reservations: [],
    events: [],
    nameById: new Map(),
    ...overrides,
  };
}

/** Build a UTC timestamp on the base Sunday at HH:MM. */
function at(hour: number, minute = 0): number {
  return Date.UTC(2024, 0, 7, hour, minute);
}

describe('daypart matchers', () => {
  it('matches a non-wrapping window inclusively at the start, exclusively at the end', () => {
    expect(minuteInDaypart(1020, DINNER)).toBe(true); // 5:00pm
    expect(minuteInDaypart(1319, DINNER)).toBe(true); // 9:59pm
    expect(minuteInDaypart(1320, DINNER)).toBe(false); // 10:00pm (next window)
    expect(minuteInDaypart(1019, DINNER)).toBe(false);
  });

  it('matches a wrapping late window on both sides of midnight (regression for dropped covers)', () => {
    expect(minuteInDaypart(1320, LATE)).toBe(true); // 10:00pm
    expect(minuteInDaypart(1439, LATE)).toBe(true); // 11:59pm
    expect(minuteInDaypart(0, LATE)).toBe(true); // 12:00am
    expect(minuteInDaypart(90, LATE)).toBe(true); // 1:30am
    expect(minuteInDaypart(120, LATE)).toBe(false); // 2:00am (window closed)
    expect(minuteInDaypart(660, LATE)).toBe(false); // 11:00am
  });

  it('detects shift overlap with a wrapping window without exceeding 1440', () => {
    expect(shiftOverlapsDaypart(1320, 1440, LATE)).toBe(true); // 10pm–midnight
    expect(shiftOverlapsDaypart(0, 360, LATE)).toBe(true); // midnight–6am touches [0,120)
    expect(shiftOverlapsDaypart(360, 660, LATE)).toBe(false); // 6am–11am
  });
});

describe('buildLaborForecast — daypart bucketing', () => {
  it('keeps a post-midnight cover in the day total AND surfaces it in the Late chip', () => {
    const result = buildLaborForecast(
      baseInput({
        reservations: [{ ts: at(1, 0), partySize: 4, isPrivateEvent: false }], // 1:00am Sunday
      }),
    );
    const sunday = result.days.find((d) => d.dayIndex === 0)!;
    expect(sunday.covers).toBe(4); // counted in the day total
    const late = sunday.dayparts.find((dp) => dp.key === 'late');
    expect(late?.covers).toBe(4); // and no longer dropped from the chip
  });

  it('buckets an 11pm cover into Late and a 7pm cover into Dinner', () => {
    const result = buildLaborForecast(
      baseInput({
        reservations: [
          { ts: at(23, 0), partySize: 2, isPrivateEvent: false },
          { ts: at(19, 0), partySize: 6, isPrivateEvent: false },
        ],
      }),
    );
    const sunday = result.days.find((d) => d.dayIndex === 0)!;
    expect(sunday.dayparts.find((dp) => dp.key === 'late')?.covers).toBe(2);
    expect(sunday.dayparts.find((dp) => dp.key === 'dinner')?.covers).toBe(6);
  });
});

describe('buildLaborForecast — staffing classification', () => {
  it('flags a day as understaffed when demand outstrips scheduled hours', () => {
    const result = buildLaborForecast(
      baseInput({
        // 80 covers -> 10 suggested labor hours; zero scheduled -> gap 10 (> 4)
        reservations: [{ ts: at(19, 0), partySize: 80, isPrivateEvent: false }],
      }),
    );
    const sunday = result.days.find((d) => d.dayIndex === 0)!;
    expect(sunday.suggestedHours).toBe(10);
    expect(sunday.status).toBe('under');
    expect(result.alerts.some((a) => a.kind === 'understaffed' && a.severity === 'critical')).toBe(true);
  });

  it('flags a day as overstaffed when scheduled hours far exceed demand', () => {
    const result = buildLaborForecast(
      baseInput({
        // One long unassigned shift, no demand -> heavily overstaffed
        shifts: [{ dayIndex: 0, startMinutes: 600, endMinutes: 1320, profileId: null }],
      }),
    );
    const sunday = result.days.find((d) => d.dayIndex === 0)!;
    expect(sunday.status).toBe('over');
    expect(result.alerts.some((a) => a.kind === 'overstaffed')).toBe(true);
  });

  it('treats a balanced day as neither under nor over', () => {
    const result = buildLaborForecast(
      baseInput({
        // 24 covers -> 3 suggested hours; a 3h shift -> gap 0
        reservations: [{ ts: at(19, 0), partySize: 24, isPrivateEvent: false }],
        shifts: [{ dayIndex: 0, startMinutes: 1020, endMinutes: 1200, profileId: 'p1' }],
      }),
    );
    const sunday = result.days.find((d) => d.dayIndex === 0)!;
    expect(sunday.status).toBe('balanced');
  });
});

describe('buildLaborForecast — overtime watch', () => {
  it('surfaces staff at/above 32h and marks those past 40h as over the limit', () => {
    // p1: 36h across the week (watch, not over). p2: 42h (over limit).
    const shifts = [
      ...Array.from({ length: 6 }, (_, i) => ({ dayIndex: i, startMinutes: 600, endMinutes: 960, profileId: 'p1' })), // 6h * 6 = 36h
      ...Array.from({ length: 6 }, (_, i) => ({ dayIndex: i, startMinutes: 600, endMinutes: 1020, profileId: 'p2' })), // 7h * 6 = 42h
    ];
    const result = buildLaborForecast(
      baseInput({ shifts, nameById: new Map([['p1', 'Alex'], ['p2', 'Sam']]) }),
    );
    const alex = result.otRisk.find((r) => r.name === 'Alex');
    const sam = result.otRisk.find((r) => r.name === 'Sam');
    expect(alex).toEqual({ name: 'Alex', scheduledHours: 36, overLimit: false });
    expect(sam).toEqual({ name: 'Sam', scheduledHours: 42, overLimit: true });
    // Sorted by hours descending: Sam before Alex.
    expect(result.otRisk.map((r) => r.name)).toEqual(['Sam', 'Alex']);
    expect(result.alerts.some((a) => a.kind === 'ot_violation')).toBe(true);
    expect(result.alerts.some((a) => a.kind === 'ot_risk')).toBe(true);
  });

  it('does not flag staff scheduled under 32h', () => {
    const result = buildLaborForecast(
      baseInput({
        shifts: [{ dayIndex: 0, startMinutes: 600, endMinutes: 1080, profileId: 'p1' }], // 8h
        nameById: new Map([['p1', 'Alex']]),
      }),
    );
    expect(result.otRisk).toHaveLength(0);
  });
});

describe('buildLaborForecast — predictive compliance alerts', () => {
  it('flags a shift of 6h or more as needing a break, but not a shorter one', () => {
    const result = buildLaborForecast(
      baseInput({
        shifts: [
          { dayIndex: 0, startMinutes: 600, endMinutes: 600 + 6 * 60, profileId: 'p1' }, // exactly 6h
          { dayIndex: 1, startMinutes: 600, endMinutes: 600 + 5 * 60, profileId: 'p1' }, // 5h
        ],
        nameById: new Map([['p1', 'Alex']]),
      }),
    );
    const breakAlerts = result.alerts.filter((a) => a.kind === 'break_reminder');
    expect(breakAlerts).toHaveLength(1);
    expect(breakAlerts[0].message).toContain('Alex');
  });

  it('collapses multiple long shifts for the same person into a single alert instead of one per shift', () => {
    const result = buildLaborForecast(
      baseInput({
        shifts: [
          { dayIndex: 0, startMinutes: 600, endMinutes: 600 + 7 * 60, profileId: 'p1' },
          { dayIndex: 1, startMinutes: 600, endMinutes: 600 + 7 * 60, profileId: 'p1' },
          { dayIndex: 2, startMinutes: 600, endMinutes: 600 + 7 * 60, profileId: 'p1' },
        ],
        nameById: new Map([['p1', 'Alex']]),
      }),
    );
    const breakAlerts = result.alerts.filter((a) => a.kind === 'break_reminder');
    expect(breakAlerts).toHaveLength(1);
    expect(breakAlerts[0].message).toContain('3 shifts');
  });

  it('aggregates unassigned long shifts into one alert distinct from named staff', () => {
    const result = buildLaborForecast(
      baseInput({
        shifts: [
          { dayIndex: 0, startMinutes: 600, endMinutes: 600 + 7 * 60, profileId: null },
          { dayIndex: 1, startMinutes: 600, endMinutes: 600 + 7 * 60, profileId: null },
        ],
        nameById: new Map(),
      }),
    );
    const breakAlerts = result.alerts.filter((a) => a.kind === 'break_reminder');
    expect(breakAlerts).toHaveLength(1);
    expect(breakAlerts[0].message).toContain('2 open shifts');
  });

  it('flags a clopening pair (close one day, open the next) under the rest threshold', () => {
    const result = buildLaborForecast(
      baseInput({
        shifts: [
          { dayIndex: 0, startMinutes: 900, endMinutes: 1380, profileId: 'p1' }, // closes 11pm
          { dayIndex: 1, startMinutes: 360, endMinutes: 720, profileId: 'p1' }, // opens 6am — 7h off
        ],
        nameById: new Map([['p1', 'Alex']]),
      }),
    );
    const risk = result.alerts.filter((a) => a.kind === 'clopening_risk');
    expect(risk).toHaveLength(1);
    expect(risk[0].severity).toBe('critical');
    expect(risk[0].message).toContain('Alex');
  });

  it('does not flag two shifts on consecutive days with adequate rest', () => {
    const result = buildLaborForecast(
      baseInput({
        shifts: [
          { dayIndex: 0, startMinutes: 600, endMinutes: 960, profileId: 'p1' }, // ends 4pm
          { dayIndex: 1, startMinutes: 600, endMinutes: 960, profileId: 'p1' }, // starts 10am next day — 18h off
        ],
        nameById: new Map([['p1', 'Alex']]),
      }),
    );
    expect(result.alerts.filter((a) => a.kind === 'clopening_risk')).toHaveLength(0);
  });
});

describe('buildLaborForecast — totals and events', () => {
  it('always returns seven days and aggregates weekly totals', () => {
    const result = buildLaborForecast(
      baseInput({
        reservations: [{ ts: at(19, 0), partySize: 16, isPrivateEvent: false }],
        shifts: [{ dayIndex: 0, startMinutes: 1020, endMinutes: 1140, profileId: 'p1' }], // 2h
      }),
    );
    expect(result.days).toHaveLength(7);
    expect(result.totals.covers).toBe(16);
    expect(result.totals.scheduledHours).toBe(2);
    expect(result.totals.suggestedHours).toBe(2); // 16 / 8
    expect(result.totals.gapHours).toBe(0);
  });

  it('splits overnight scheduled hours onto the next calendar day', () => {
    const result = buildLaborForecast(
      baseInput({
        shifts: [{ weekStart: '2024-01-07', dayIndex: 0, startMinutes: 1320, endMinutes: 1560, profileId: 'p1' }],
        nameById: new Map([['p1', 'Closer']]),
      }),
    );
    const sunday = result.days.find((d) => d.dayIndex === 0)!;
    const monday = result.days.find((d) => d.dayIndex === 1)!;
    expect(sunday.scheduledHours).toBe(2);
    expect(monday.scheduledHours).toBe(2);
    expect(monday.dayparts.find((dp) => dp.key === 'late')?.scheduledPeople).toBe(1);
  });

  it('treats a venue event as a private-event labor block even with no covers', () => {
    const result = buildLaborForecast(
      baseInput({
        events: [{ ts: at(18, 0), expectedGuests: null }],
      }),
    );
    const sunday = result.days.find((d) => d.dayIndex === 0)!;
    expect(sunday.privateEvents).toBe(1);
    expect(sunday.suggestedHours).toBe(6); // PRIVATE_EVENT_HOURS, no cover contribution
  });
});
