import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { FloorService } from './floor.service';

describe('FloorService regressions', () => {
  it('serializes floor-plan saves per venue', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      floorPlan: {
        findFirst: vi.fn().mockResolvedValue({ id: 'plan-1', width: 800, height: 600 }),
        update: vi.fn().mockResolvedValue({ id: 'plan-1' }),
      },
      floorTable: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
      tableAssignment: { count: vi.fn().mockResolvedValue(0) },
      floorChair: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = new FloorService(prisma as any, {} as any);

    await service.saveFloorPlan('venue-1', { tables: [] });

    expect(transaction.$executeRaw).toHaveBeenCalledOnce();
    expect(transaction.floorPlan.findFirst).toHaveBeenCalledWith({ where: { venueId: 'venue-1', isActive: true } });
  });

  it('writes floor-plan table creates and updates as set-based batches, not per-row', async () => {
    // Regression for the sequential for-loop that drove one create()/update()
    // round-trip per table inside this same advisory-locked transaction —
    // unbounded before @ArrayMaxSize(500), and still up to 500 round-trips
    // even capped. This asserts the batch shape directly rather than just
    // checking the save succeeds.
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      floorPlan: {
        findFirst: vi.fn().mockResolvedValue({ id: 'plan-1', width: 800, height: 600 }),
        update: vi.fn().mockResolvedValue({ id: 'plan-1' }),
      },
      floorTable: {
        findMany: vi.fn().mockResolvedValue([{ id: 'existing-1' }]),
        deleteMany: vi.fn(),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn(),
        update: vi.fn(),
      },
      tableState: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn(),
      },
      tableAssignment: { count: vi.fn().mockResolvedValue(0) },
      floorChair: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = new FloorService(prisma as any, {} as any);

    await service.saveFloorPlan('venue-1', {
      tables: [
        { id: 'existing-1', label: 'A1', x: 0, y: 0, width: 10, height: 10, shape: 'round', capacity: 4 },
        { label: 'A2', x: 1, y: 1, width: 10, height: 10, shape: 'square', capacity: 2 },
      ],
    });

    expect(transaction.floorTable.createMany).toHaveBeenCalledTimes(1);
    expect(transaction.floorTable.createMany.mock.calls[0][0].data).toHaveLength(1);
    expect(transaction.floorTable.create).not.toHaveBeenCalled();
    expect(transaction.floorTable.update).not.toHaveBeenCalled();
    expect(transaction.tableState.createMany).toHaveBeenCalledTimes(1);
    expect(transaction.tableState.create).not.toHaveBeenCalled();
    // One advisory-lock call plus exactly one bulk UPDATE...FROM (VALUES) —
    // not one $executeRaw per updated table.
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(2);
    const updateSql = (transaction.$executeRaw.mock.calls[1][0] as TemplateStringsArray).join('');
    expect(updateSql).toContain('UPDATE "FloorTable"');
    expect(updateSql).toContain('FROM (VALUES');
  });

  it('skips both the create and update batches when saveFloorPlan is called with no tables', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      floorPlan: {
        findFirst: vi.fn().mockResolvedValue({ id: 'plan-1', width: 800, height: 600 }),
        update: vi.fn().mockResolvedValue({ id: 'plan-1' }),
      },
      floorTable: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn(), createMany: vi.fn() },
      tableState: { createMany: vi.fn() },
      tableAssignment: { count: vi.fn().mockResolvedValue(0) },
      floorChair: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = new FloorService(prisma as any, {} as any);

    await service.saveFloorPlan('venue-1', { tables: [] });

    expect(transaction.floorTable.createMany).not.toHaveBeenCalled();
    expect(transaction.tableState.createMany).not.toHaveBeenCalled();
    // Only the advisory lock — no bulk UPDATE issued for zero updated tables.
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
  });

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

  it('rejects a table-status write that loses an optimistic concurrency race', async () => {
    const lastActivityAt = new Date();
    const prisma = {
      tableState: {
        findFirst: vi.fn().mockResolvedValue({ id: 'state-1', lastActivityAt }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const service = new FloorService(prisma as any, {} as any);

    await expect(service.updateTableStatus('venue-1', 'table-1', 'dirty')).rejects.toThrow(
      'Table status changed. Refresh and try again.',
    );
    expect(prisma.tableState.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'state-1', venueId: 'venue-1', lastActivityAt },
    }));
  });
});
