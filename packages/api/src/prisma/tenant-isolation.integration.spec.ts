import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb } from '../test/setup-test-db';
import { tenantIsolationExtension } from './tenant-isolation.extension';
import { runWithTenant } from './tenant-context';

/**
 * End-to-end proof that the tenant-isolation extension actually isolates tenants
 * against a real Postgres. Skips gracefully when no test DB is available (no
 * Docker / TEST_DATABASE_URL), like the scheduling concurrency spec.
 */
describe('tenant isolation extension (integration)', () => {
  let base: PrismaClient;
  let db: ReturnType<typeof makeExtended> | null = null;
  let teardown: () => Promise<void> = async () => {};
  let venueA = '';
  let venueB = '';

  function makeExtended(client: PrismaClient) {
    return client.$extends(tenantIsolationExtension());
  }

  beforeAll(async () => {
    try {
      const setup = await setupTestDb();
      base = setup.prisma;
      teardown = setup.teardown;
    } catch (err) {
      console.warn('Skipping tenant-isolation integration tests — no test DB:', (err as Error).message);
      db = null;
      return;
    }
    db = makeExtended(base);

    // Two tenants, each with one bar inventory item. Seeded WITHOUT a tenant
    // context so the extension stays inert during setup.
    const [a, b] = await Promise.all([
      base.venue.create({ data: { name: 'Venue A', latitude: 0, longitude: 0, geofenceRadiusM: 100, timezone: 'UTC' } }),
      base.venue.create({ data: { name: 'Venue B', latitude: 0, longitude: 0, geofenceRadiusM: 100, timezone: 'UTC' } }),
    ]);
    venueA = a.id;
    venueB = b.id;
    await Promise.all([
      base.barInventoryItem.create({ data: { venueId: venueA, name: 'A-Gin', category: 'spirit', unit: 'bottle', parLevel: 1, onHand: 1 } }),
      base.barInventoryItem.create({ data: { venueId: venueB, name: 'B-Rum', category: 'spirit', unit: 'bottle', parLevel: 1, onHand: 1 } }),
    ]);
  }, 60_000);

  afterAll(async () => {
    if (db) {
      await base.barInventoryItem.deleteMany();
      await base.venue.deleteMany();
    }
    await teardown();
  });

  // Prisma queries are lazy (PrismaPromise executes on await), so the await MUST
  // happen inside the tenant context — otherwise run() has already exited by the
  // time the query runs and the extension sees no venueId. Mirrors the real
  // enablement path (AuthGuard -> enterTenant), which persists for the request.
  const asTenant = <T>(venueId: string, fn: () => Promise<T>): Promise<T> =>
    runWithTenant(venueId, async () => await fn());

  it('findMany returns only the bound tenant rows', async () => {
    if (!db) return;
    const rows = await asTenant(venueA, () => db!.barInventoryItem.findMany());
    expect(rows.map((r) => r.name)).toEqual(['A-Gin']);
  });

  it('a hostile where cannot reach another tenant', async () => {
    if (!db) return;
    // Ask (as Venue A) for Venue B's rows — the AND-ed predicate yields nothing.
    const rows = await asTenant(venueA, () => db!.barInventoryItem.findMany({ where: { venueId: venueB } }));
    expect(rows).toHaveLength(0);
  });

  it('without a tenant context the extension is inert (sees all)', async () => {
    if (!db) return;
    const rows = await db.barInventoryItem.findMany();
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('create forces the bound venueId regardless of supplied data', async () => {
    if (!db) return;
    const created = await asTenant(venueA, () =>
      db!.barInventoryItem.create({ data: { venueId: venueB, name: 'A-Vodka', category: 'spirit', unit: 'bottle', parLevel: 1, onHand: 1 } }),
    );
    expect(created.venueId).toBe(venueA);
    await base.barInventoryItem.delete({ where: { id: created.id } });
  });
});
