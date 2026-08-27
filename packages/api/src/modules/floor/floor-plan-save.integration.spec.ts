import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { setupTestDb } from '../../test/setup-test-db';
import type { PrismaService } from '../../prisma/prisma.service';
import { FloorService } from './floor.service';

const asPrismaService = () => prisma as unknown as PrismaService;

/**
 * saveFloorPlan's table create/update paths were rewritten from one
 * create()/update() round-trip per table into a createMany batch plus a
 * single hand-written `UPDATE ... FROM (VALUES ...)` statement (see
 * floor.service.spec.ts for the mocked call-shape assertions). The raw SQL —
 * enum casts, quoted column names, the VALUES tuple order — can only be
 * proven correct against a real Postgres, not a mocked Prisma client.
 */
let prisma: PrismaClient;
let teardown: () => Promise<void> = async () => {};

beforeAll(async () => {
  const db = await setupTestDb();
  prisma = db.prisma;
  teardown = db.teardown;
});

afterAll(async () => {
  await teardown();
}, 15_000);

async function seedVenue() {
  return prisma.venue.create({
    data: {
      name: 'Floor Test Venue',
      code: 'VW-FLOOR01',
      latitude: 40.7,
      longitude: -74.0,
      geofenceRadiusM: 100,
      timezone: 'America/New_York',
    },
  });
}

describe('FloorService.saveFloorPlan (integration)', () => {
  afterEach(async () => {
    await prisma.tableAssignment.deleteMany();
    await prisma.tableState.deleteMany();
    await prisma.floorChair.deleteMany();
    await prisma.floorTable.deleteMany();
    await prisma.floorPlan.deleteMany();
    await prisma.venue.deleteMany();
  });

  it('creates tables via the batch insert path with correct enum casts and TableState rows', async () => {
    const venue = await seedVenue();
    const service = new FloorService(asPrismaService(), {} as any);

    await service.saveFloorPlan(venue.id, {
      tables: [
        { label: 'Patio 1', x: 1, y: 2, width: 30, height: 30, shape: 'round', section: 'patio', capacity: 4, isReservable: true, minSpend: 5000 },
        { label: 'Bar 3', x: 10, y: 12, width: 20, height: 20, shape: 'square', section: 'bar', capacity: 2 },
      ],
    });

    const plan = await prisma.floorPlan.findFirstOrThrow({ where: { venueId: venue.id, isActive: true } });
    const tables = await prisma.floorTable.findMany({ where: { floorPlanId: plan.id }, orderBy: { label: 'asc' } });
    expect(tables).toHaveLength(2);
    expect(tables[0]).toMatchObject({ label: 'Bar 3', shape: 'square', section: 'bar', seats: 2, minSpend: 0, isReservable: true });
    expect(tables[1]).toMatchObject({ label: 'Patio 1', shape: 'round', section: 'patio', seats: 4, minSpend: 5000, isReservable: true });

    const states = await prisma.tableState.findMany({ where: { venueId: venue.id } });
    expect(states).toHaveLength(2);
    expect(states.every((s) => s.status === 'available')).toBe(true);
  });

  it('updates existing tables via the raw bulk UPDATE without touching untouched columns or other tables', async () => {
    const venue = await seedVenue();
    const service = new FloorService(asPrismaService(), {} as any);

    await service.saveFloorPlan(venue.id, {
      tables: [
        { label: 'Table 1', x: 0, y: 0, width: 10, height: 10, shape: 'round', section: 'main', capacity: 4 },
        { label: 'Table 2', x: 5, y: 5, width: 10, height: 10, shape: 'round', section: 'main', capacity: 6 },
      ],
    });
    const plan = await prisma.floorPlan.findFirstOrThrow({ where: { venueId: venue.id, isActive: true } });
    const [table1, table2] = await prisma.floorTable.findMany({ where: { floorPlanId: plan.id }, orderBy: { label: 'asc' } });

    // Second save: update table1's shape/section/capacity, leave table2 as a
    // pass-through untouched entry in the same submitted array.
    await service.saveFloorPlan(venue.id, {
      tables: [
        { id: table1.id, label: 'Table 1', x: 0, y: 0, width: 10, height: 10, shape: 'square', section: 'vip', capacity: 8, minSpend: 10000, isReservable: false },
        { id: table2.id, label: 'Table 2', x: 5, y: 5, width: 10, height: 10, shape: 'round', section: 'main', capacity: 6 },
      ],
    });

    const updated1 = await prisma.floorTable.findUniqueOrThrow({ where: { id: table1.id } });
    expect(updated1).toMatchObject({ shape: 'square', section: 'vip', seats: 8, minSpend: 10000, isReservable: false });

    const updated2 = await prisma.floorTable.findUniqueOrThrow({ where: { id: table2.id } });
    expect(updated2).toMatchObject({ shape: 'round', section: 'main', seats: 6 });

    // No row was duplicated or orphaned by the batch split.
    const allTables = await prisma.floorTable.findMany({ where: { floorPlanId: plan.id } });
    expect(allTables).toHaveLength(2);
  });

  it('handles a save that mixes a new table with an update to an existing one in the same request', async () => {
    const venue = await seedVenue();
    const service = new FloorService(asPrismaService(), {} as any);

    await service.saveFloorPlan(venue.id, {
      tables: [{ label: 'Existing', x: 0, y: 0, width: 10, height: 10, shape: 'round', section: 'main', capacity: 4 }],
    });
    const plan = await prisma.floorPlan.findFirstOrThrow({ where: { venueId: venue.id, isActive: true } });
    const [existing] = await prisma.floorTable.findMany({ where: { floorPlanId: plan.id } });

    await service.saveFloorPlan(venue.id, {
      tables: [
        { id: existing.id, label: 'Existing Renamed', x: 0, y: 0, width: 10, height: 10, shape: 'round', section: 'main', capacity: 4 },
        { label: 'Brand New', x: 20, y: 20, width: 10, height: 10, shape: 'booth', section: 'bar', capacity: 5 },
      ],
    });

    const tables = await prisma.floorTable.findMany({ where: { floorPlanId: plan.id }, orderBy: { label: 'asc' } });
    expect(tables).toHaveLength(2);
    expect(tables.map((t) => t.label)).toEqual(['Brand New', 'Existing Renamed']);
    // One TableState from the first save's create, one more from this save's
    // single new table — the update to "Existing" must not add another.
    const states = await prisma.tableState.findMany({ where: { venueId: venue.id } });
    expect(states).toHaveLength(2);
  });
});
