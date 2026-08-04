import { describe, expect, it } from 'vitest';
import { buildDailyBriefPriorityActions } from './daily-brief-priority-actions';

const ZERO = { openShiftCount: 0, pendingRequestCount: 0, lowStockCount: 0, eightySixCount: 0, events: [] as any[] };

describe('buildDailyBriefPriorityActions', () => {
  it('returns a steady-state action when nothing needs attention', () => {
    expect(buildDailyBriefPriorityActions(ZERO)).toEqual([
      {
        kind: 'steady',
        tone: 'good',
        title: 'Service looks on track',
        body: 'No urgent event prep, coverage, request, or stock issues are blocking the shift.',
        cta: 'Open reports',
        route: '/reports',
      },
    ]);
  });

  it('puts event prep ahead of the other operational work', () => {
    expect(
      buildDailyBriefPriorityActions({
        ...ZERO,
        openShiftCount: 2,
        pendingRequestCount: 1,
        lowStockCount: 3,
        events: [{ title: 'Private dinner', startsAt: 1, expectedGuests: 24, reservationGuestName: 'Smith', reservationPartySize: null, notes: null }],
      }),
    ).toEqual([
      {
        kind: 'event',
        tone: 'warn',
        title: 'Prep Smith',
        body: '24 guests expected. Review the run sheet, seating plan, and service notes before doors open.',
        cta: 'Open reservations',
        route: '/reservations',
      },
      {
        kind: 'coverage',
        tone: 'warn',
        title: 'Cover 2 open shifts',
        body: 'Get the floor staffed before service so the shift starts with the right coverage.',
        cta: 'Open staff',
        route: '/staff',
      },
      {
        kind: 'requests',
        tone: 'neutral',
        title: 'Review 1 pending request',
        body: 'Approve or deny the queue now so the schedule stays stable for the next publish.',
        cta: 'Open schedule',
        route: '/schedule',
      },
      {
        kind: 'stock',
        tone: 'warn',
        title: '3 low-stock items need attention',
        body: 'Top up the bar list before the problem turns into a comp or a missed sale.',
        cta: 'Open inventory',
        route: '/bar-stock',
      },
    ]);
  });

  it('falls back to stock actions when there are no events or staffing issues', () => {
    expect(
      buildDailyBriefPriorityActions({
        ...ZERO,
        lowStockCount: 1,
        eightySixCount: 2,
      }),
    ).toEqual([
      {
        kind: 'stock',
        tone: 'warn',
        title: '1 low-stock item needs attention',
        body: "1 low-stock item needs attention and 2 items are already 86'd. Refill before they interrupt service.",
        cta: 'Open inventory',
        route: '/bar-stock',
      },
    ]);
  });
});
