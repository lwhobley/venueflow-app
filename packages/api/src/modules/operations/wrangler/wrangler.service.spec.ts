import { describe, expect, it, vi } from 'vitest';
import { WranglerService } from './wrangler.service';

describe('WranglerService reservation reassignment', () => {
  it('includes the previous calendar day only when a shift spills past midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-24T01:00:00.000Z'));
    try {
      const findMany = vi.fn().mockResolvedValue([]);
      const service = new WranglerService({ scheduleShift: { findMany } } as any);

      await service.getSnapshot('venue-1', 'UTC');

      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          venueId: 'venue-1',
          OR: [
            { weekStart: '2026-08-23', dayIndex: 1 },
            { weekStart: '2026-08-23', dayIndex: 0, endMinutes: { gt: 1440 } },
          ],
        },
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('shares the reservation-holds venue lock with standard reservation mutations', async () => {
    const tx: any = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      reservation: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'reservation-1', partySize: 2,
          reservationTime: new Date('2026-08-10T18:00:00.000Z'), durationMinutes: 90,
        }),
      },
      floorTable: { findFirst: vi.fn().mockResolvedValue({ id: 'table-1', label: 'T1' }) },
      tableState: {
        findFirst: vi.fn().mockResolvedValue({ status: 'available' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      tableAssignment: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({ id: 'assignment-1' }),
      },
    };
    const prisma: any = {
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    };
    const service = new WranglerService(prisma);

    await service.executeAction('venue-1', {
      type: 'REASSIGN_RESERVATION', reservationId: 'reservation-1', tableId: 'table-1',
    });

    expect(tx.$executeRaw.mock.calls[0]?.[1]).toBe('reservation-holds:venue-1');
    expect(tx.tableAssignment.create).toHaveBeenCalled();
    expect(tx.reservation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { notIn: ['cancelled', 'no_show', 'completed'] } }),
    }));
  });

  it('refuses a reassignment when the reservation is no longer active under the lock', async () => {
    const tx: any = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      reservation: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const prisma: any = { $transaction: vi.fn(async (callback: any) => callback(tx)) };

    await expect(new WranglerService(prisma).executeAction('venue-1', {
      type: 'REASSIGN_RESERVATION', reservationId: 'reservation-1', tableId: 'table-1',
    })).rejects.toThrow('Reservation is no longer active');
  });
});
