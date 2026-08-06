import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { FloorService } from './floor.service';

describe('FloorService regressions', () => {
  it('returns the saved seat-label style in the active floor payload', async () => {
    const now = new Date();
    const prisma = {
      floorPlan: { findFirst: vi.fn().mockResolvedValue({
        id: 'plan-1', venueId: 'venue-1', name: 'Main', width: 900, height: 600,
        backgroundImageUrl: null, isActive: true, createdAt: now, updatedAt: now,
        chairs: [],
        tables: [{
          id: 'table-1', floorPlanId: 'plan-1', label: '12', shape: 'round', seats: 4,
          seatLabelStyle: 'letter', x: 10, y: 20, width: 80, height: 80, rotation: 0,
          section: 'main', minSpend: 0, isReservable: true,
        }],
      }) },
      tableState: { findMany: vi.fn().mockResolvedValue([]) },
      tableAssignment: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new FloorService(prisma as any, {} as any);

    const result = await service.getActiveFloorPlan('venue-1');

    expect(result?.tables[0].table.seatLabelStyle).toBe('letter');
  });

  it('requires an existing merge to be split before those tables are merged again', async () => {
    const prisma = {
      floorPlan: { findFirst: vi.fn().mockResolvedValue({ tables: [{ id: 't1' }, { id: 't2' }] }) },
      tableState: { findMany: vi.fn().mockResolvedValue([
        { id: 's1', tableId: 't1', status: 'seated', mergeGroupId: 'group-1' },
        { id: 's2', tableId: 't2', status: 'seated', mergeGroupId: 'group-1' },
      ]), updateMany: vi.fn() },
    };
    const service = new FloorService(prisma as any, {} as any);

    await expect(service.mergeTablesForParty('venue-1', ['t1', 't2'], 6)).rejects.toThrow(ConflictException);
    expect(prisma.tableState.updateMany).not.toHaveBeenCalled();
  });
});
