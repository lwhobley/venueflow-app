import { describe, expect, it, vi } from 'vitest';
import { WranglerHistoryService } from './wrangler-history.service';

describe('WranglerHistoryService', () => {
  it('surfaces above-pattern demand from comparable weekdays', async () => {
    const prisma = {
      reservation: { findMany: vi.fn().mockResolvedValue([
        { reservationTime: new Date('2026-08-01T18:00:00Z'), partySize: 40, status: 'completed' },
        { reservationTime: new Date('2026-07-25T18:00:00Z'), partySize: 50, status: 'completed' },
      ]) },
      posCheck: { findMany: vi.fn().mockResolvedValue([]) },
      posLaborPunch: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new WranglerHistoryService(prisma as never);
    const patterns = await service.getPatterns({ venueId: 'venue-1', timezone: 'UTC', nowMs: new Date('2026-08-08T12:00:00Z').getTime(), todayCovers: 80, todayReservations: 8 });
    expect(patterns.some((pattern) => pattern.id === 'history-demand-up')).toBe(true);
  });

  it('requires at least two comparable service samples', async () => {
    const prisma = {
      reservation: { findMany: vi.fn().mockResolvedValue([{ reservationTime: new Date('2026-08-01T18:00:00Z'), partySize: 40, status: 'completed' }]) },
      posCheck: { findMany: vi.fn().mockResolvedValue([]) },
      posLaborPunch: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new WranglerHistoryService(prisma as never);
    const patterns = await service.getPatterns({ venueId: 'venue-1', timezone: 'UTC', nowMs: new Date('2026-08-08T12:00:00Z').getTime(), todayCovers: 80, todayReservations: 8 });
    expect(patterns).toEqual([]);
  });
});
