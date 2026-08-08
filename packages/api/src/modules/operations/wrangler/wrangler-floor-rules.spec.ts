import { describe, expect, it } from 'vitest';
import { buildWranglerFloorActions } from './wrangler-floor-rules';

const NOW = new Date('2026-08-08T19:00:00.000Z').getTime();

describe('buildWranglerFloorActions', () => {
  it('flags an incoming VIP whose assigned table is still seated', () => {
    const results = buildWranglerFloorActions({
      now: NOW,
      tables: [
        { tableId: 't18', label: 'Table 18', status: 'seated', seatedAt: NOW - 95 * 60_000 },
      ],
      upcomingAssignments: [
        {
          assignmentId: 'a1',
          tableId: 't18',
          tableLabel: 'Table 18',
          startsAt: NOW + 18 * 60_000,
          reservationId: 'r1',
          guestName: 'Jordan Carter',
          partySize: 4,
          tags: ['VIP'],
        },
      ],
    });

    expect(results[0]).toMatchObject({
      id: 'floor-conflict:a1',
      kind: 'floor',
      severity: 'critical',
      route: '/floor',
    });
  });

  it('flags a table seated beyond the service window', () => {
    const results = buildWranglerFloorActions({
      now: NOW,
      tables: [
        { tableId: 't22', label: 'Table 22', status: 'seated', seatedAt: NOW - 132 * 60_000 },
      ],
      upcomingAssignments: [],
      longSeatedMinutes: 120,
    });

    expect(results[0]).toMatchObject({
      id: 'floor-long-seated:t22',
      kind: 'floor',
      severity: 'watch',
      route: '/floor',
      title: 'Table 22 has been seated 132 min',
    });
  });

  it('ignores an upcoming assignment when the table is already clear', () => {
    const results = buildWranglerFloorActions({
      now: NOW,
      tables: [
        { tableId: 't12', label: 'Table 12', status: 'available', seatedAt: null },
      ],
      upcomingAssignments: [
        {
          assignmentId: 'a2',
          tableId: 't12',
          tableLabel: 'Table 12',
          startsAt: NOW + 10 * 60_000,
          reservationId: 'r2',
          guestName: 'Alex Morgan',
          partySize: 2,
          tags: [],
        },
      ],
    });

    expect(results).toEqual([]);
  });
});
