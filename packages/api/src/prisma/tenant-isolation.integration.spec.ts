import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb } from '../test/setup-test-db';
import { tenantIsolationExtension } from './tenant-isolation.extension';
import { runWithTenant } from './tenant-context';

/**
 * End-to-end proof that the tenant-isolation extension actually isolates tenants
 * against a real Postgres.
 */
describe('tenant isolation extension (integration)', () => {
  let base: PrismaClient;
  let db: ReturnType<typeof makeExtended>;
  let teardown: () => Promise<void> = async () => {};
  let venueA = '';
  let venueB = '';
  let profileB = '';

  function makeExtended(client: PrismaClient) {
    return client.$extends(tenantIsolationExtension());
  }

  beforeAll(async () => {
    const setup = await setupTestDb();
    base = setup.prisma;
    teardown = setup.teardown;
    db = makeExtended(base);

    // Two tenants, each with one bar inventory item. Seeded WITHOUT a tenant
    // context so the extension stays inert during setup.
    const [a, b] = await Promise.all([
      base.venue.create({ data: { name: 'Venue A', code: 'VW-TENANTA001', latitude: 0, longitude: 0, geofenceRadiusM: 100, timezone: 'UTC' } }),
      base.venue.create({ data: { name: 'Venue B', code: 'VW-TENANTB001', latitude: 0, longitude: 0, geofenceRadiusM: 100, timezone: 'UTC' } }),
    ]);
    venueA = a.id;
    venueB = b.id;
    profileB = (await base.profile.create({
      data: {
        venueId: venueB,
        email: 'tenant-b@example.test',
        fullName: 'Tenant B Staff',
        role: 'staff',
        jobTitle: 'Server',
        membershipStatus: 'active',
      },
    })).id;
    await Promise.all([
      base.barInventoryItem.create({ data: { venueId: venueA, name: 'A-Gin', normalizedName: 'a-gin', category: 'spirit', unit: 'bottle', parLevel: 1, onHand: 1 } }),
      base.barInventoryItem.create({ data: { venueId: venueB, name: 'B-Rum', normalizedName: 'b-rum', category: 'spirit', unit: 'bottle', parLevel: 1, onHand: 1 } }),
    ]);
  });

  afterAll(async () => {
    if (!base) return;
    await base.barInventoryItem.deleteMany();
    await base.scheduleShift.deleteMany();
    await base.profile.deleteMany();
    await base.venue.deleteMany();
    await teardown();
  });

  // Prisma queries are lazy (PrismaPromise executes on await), so the await MUST
  // happen inside the tenant context — otherwise run() has already exited by the
  // time the query runs and the extension sees no venueId. Mirrors the real
  // enablement path (AuthGuard -> enterTenant), which persists for the request.
  const asTenant = <T>(venueId: string, fn: () => Promise<T>): Promise<T> =>
    runWithTenant(venueId, async () => await fn());

  it('findMany returns only the bound tenant rows', async () => {
    const rows = await asTenant(venueA, () => db.barInventoryItem.findMany());
    expect(rows.map((r) => r.name)).toEqual(['A-Gin']);
  });

  it('a hostile where cannot reach another tenant', async () => {
    // Ask (as Venue A) for Venue B's rows — the AND-ed predicate yields nothing.
    const rows = await asTenant(venueA, () => db.barInventoryItem.findMany({ where: { venueId: venueB } }));
    expect(rows).toHaveLength(0);
  });

  it('findUnique cannot reach another tenant by id', async () => {
    const otherTenantItem = await base.barInventoryItem.findFirstOrThrow({ where: { venueId: venueB } });
    const row = await asTenant(venueA, () => db.barInventoryItem.findUnique({ where: { id: otherTenantItem.id } }));
    expect(row).toBeNull();
  });

  it('without a tenant context the extension is inert (sees all)', async () => {
    const rows = await db.barInventoryItem.findMany();
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('create forces the bound venueId regardless of supplied data', async () => {
    const created = await asTenant(venueA, () =>
      db.barInventoryItem.create({ data: { venueId: venueB, name: 'A-Vodka', normalizedName: 'a-vodka', category: 'spirit', unit: 'bottle', parLevel: 1, onHand: 1 } }),
    );
    expect(created.venueId).toBe(venueA);
    await base.barInventoryItem.delete({ where: { id: created.id } });
  });

  // ── Unique-keyed writes ──────────────────────────────────────────────────
  //
  // update/delete/upsert go through mergeUniqueVenueWhere, which appends
  // venueId to a WhereUniqueInput and relies on Prisma's extended-unique-where
  // behaviour. Only the argument shaping was covered by unit tests; what
  // Prisma and Postgres actually do with those arguments was not, so deleting
  // the UNIQUE_KEYED_OPERATIONS branch left every test passing.

  it('update cannot reach another tenant by id', async () => {
    const otherTenantItem = await base.barInventoryItem.findFirstOrThrow({ where: { venueId: venueB } });

    await expect(
      asTenant(venueA, () => db.barInventoryItem.update({
        where: { id: otherTenantItem.id },
        data: { name: 'HIJACKED' },
      })),
    ).rejects.toThrow();

    const after = await base.barInventoryItem.findUniqueOrThrow({ where: { id: otherTenantItem.id } });
    expect(after.name).toBe('B-Rum');
  });

  it('delete cannot reach another tenant by id', async () => {
    const otherTenantItem = await base.barInventoryItem.findFirstOrThrow({ where: { venueId: venueB } });

    await expect(
      asTenant(venueA, () => db.barInventoryItem.delete({ where: { id: otherTenantItem.id } })),
    ).rejects.toThrow();

    expect(await base.barInventoryItem.findUnique({ where: { id: otherTenantItem.id } })).not.toBeNull();
  });

  it('update cannot move a row into another tenant via data.venueId', async () => {
    const own = await base.barInventoryItem.findFirstOrThrow({ where: { venueId: venueA } });

    const updated = await asTenant(venueA, () => db.barInventoryItem.update({
      where: { id: own.id },
      data: { venueId: venueB, name: 'A-Gin' },
    }));

    expect(updated.venueId).toBe(venueA);
  });

  it('updateMany with a hostile where affects no rows', async () => {
    const result = await asTenant(venueA, () => db.barInventoryItem.updateMany({
      where: { venueId: venueB },
      data: { name: 'HIJACKED' },
    }));

    expect(result.count).toBe(0);
    const untouched = await base.barInventoryItem.findFirstOrThrow({ where: { venueId: venueB } });
    expect(untouched.name).toBe('B-Rum');
  });

  it('upsert on another tenant unique key creates inside the bound tenant instead', async () => {
    // The extended filter does not match, so Prisma falls through to the create
    // branch — which scopeArgs forces into the bound venue. The other tenant's
    // row must be left exactly as it was.
    const otherTenantItem = await base.barInventoryItem.findFirstOrThrow({ where: { venueId: venueB } });

    const result = await asTenant(venueA, () => db.barInventoryItem.upsert({
      where: { id: otherTenantItem.id },
      update: { name: 'HIJACKED' },
      create: {
        venueId: venueB,
        name: 'A-Upserted',
        normalizedName: 'a-upserted',
        category: 'spirit',
        unit: 'bottle',
        parLevel: 1,
        onHand: 1,
      },
    }));

    expect(result.venueId).toBe(venueA);
    const otherAfter = await base.barInventoryItem.findUniqueOrThrow({ where: { id: otherTenantItem.id } });
    expect(otherAfter.name).toBe('B-Rum');
    await base.barInventoryItem.delete({ where: { id: result.id } });
  });

  it('upsert still updates the bound tenant own row', async () => {
    const own = await base.barInventoryItem.findFirstOrThrow({ where: { venueId: venueA } });

    const result = await asTenant(venueA, () => db.barInventoryItem.upsert({
      where: { id: own.id },
      update: { parLevel: 9 },
      create: {
        venueId: venueA,
        name: 'unused',
        normalizedName: 'unused',
        category: 'spirit',
        unit: 'bottle',
        parLevel: 1,
        onHand: 1,
      },
    }));

    expect(result.id).toBe(own.id);
    expect(result.parLevel).toBe(9);
    await base.barInventoryItem.update({ where: { id: own.id }, data: { parLevel: 1 } });
  });

  it('database constraints reject a cross-tenant scheduling reference even without tenant context', async () => {
    await expect(base.scheduleShift.create({
      data: {
        venueId: venueA,
        profileId: profileB,
        weekStart: '2026-08-23',
        dayIndex: 0,
        startMinutes: 600,
        endMinutes: 900,
        jobTitle: 'Server',
        station: 'Floor',
        status: 'scheduled',
      },
    })).rejects.toThrow();
  });
});
