import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { resolve } from 'path';

let containerCleanup: (() => Promise<void>) | null = null;

type TestDatabaseSafetyEnv = Partial<Pick<NodeJS.ProcessEnv,
  | 'NODE_ENV'
  | 'DATABASE_URL'
  | 'DATABASE_DIRECT_URL'
  | 'ALLOW_REMOTE_TEST_DB_RESET'
  | 'TEST_DATABASE_FINGERPRINT'
>>;

function databaseIdentity(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  return `${parsed.hostname.toLowerCase()}:${parsed.port || '5432'}/${database}`;
}

/**
 * Integration setup applies migrations and may therefore change the target
 * schema. Keep that capability constrained to an unmistakably disposable DB.
 * Remote branches require an exact host/port/database fingerprint in addition
 * to an explicit opt-in so a copied production URL cannot be reset by typo.
 */
export function assertDisposableTestDatabase(url: string, env: TestDatabaseSafetyEnv = process.env): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing integration database setup while NODE_ENV=production.');
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('TEST_DATABASE_URL must use the postgres or postgresql protocol.');
  }

  const targetIdentity = databaseIdentity(url);
  for (const [name, runtimeUrl] of [
    ['DATABASE_URL', env.DATABASE_URL],
    ['DATABASE_DIRECT_URL', env.DATABASE_DIRECT_URL],
  ] as const) {
    if (runtimeUrl && databaseIdentity(runtimeUrl) === targetIdentity) {
      throw new Error(`Refusing integration setup: TEST_DATABASE_URL matches ${name}.`);
    }
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!/(^|[_-])(test|integration)($|[_-])/i.test(database)) {
    throw new Error(`Refusing integration setup for database without a test marker: ${database || '(empty)'}.`);
  }

  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname.toLowerCase());
  if (isLocal) return;
  if (env.ALLOW_REMOTE_TEST_DB_RESET !== 'true') {
    throw new Error('Remote integration databases require ALLOW_REMOTE_TEST_DB_RESET=true.');
  }
  if (!env.TEST_DATABASE_FINGERPRINT || env.TEST_DATABASE_FINGERPRINT !== targetIdentity) {
    throw new Error(`Remote integration database fingerprint must exactly equal ${targetIdentity}.`);
  }
}

/**
 * Provision a test Postgres database. Tries, in order:
 *   1. TEST_DATABASE_URL env var (Neon branch, local PG, etc.)
 *   2. Testcontainers (requires Docker)
 * Returns a connected PrismaClient + teardown function.
 * Throws if neither source is available.
 */
export async function setupTestDb(): Promise<{
  prisma: PrismaClient;
  url: string;
  teardown: () => Promise<void>;
}> {
  let url: string;

  if (process.env.TEST_DATABASE_URL) {
    url = process.env.TEST_DATABASE_URL;
  } else {
    const pg = await startContainer();
    url = pg.url;
    containerCleanup = pg.stop;
  }

  assertDisposableTestDatabase(url);

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  // Use the production migration history, not `db push`: partial indexes,
  // check constraints, RLS, and privilege changes live only in migration SQL.
  execSync('npx prisma migrate deploy --schema prisma/schema.prisma', {
    env: { ...process.env, DATABASE_URL: url, DATABASE_DIRECT_URL: url },
    cwd: resolve(__dirname, '../..'),
    stdio: 'pipe',
  });
  await prisma.$connect();

  return {
    prisma,
    url,
    teardown: async () => {
      await prisma.$disconnect();
      if (containerCleanup) await containerCleanup();
    },
  };
}

async function startContainer(): Promise<{ url: string; stop: () => Promise<void> }> {
  // Dynamic import so the dep is optional
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('test')
    .withUsername('test')
    .withPassword('test')
    .start();
  return {
    url: container.getConnectionUri(),
    stop: async () => { await container.stop(); },
  };
}

/**
 * Seed minimal data for scheduling concurrency tests.
 * Returns stable IDs for the venue, two profiles, and a pre-created open shift.
 */
export async function seedSchedulingFixtures(prisma: PrismaClient) {
  const venue = await prisma.venue.create({
    data: {
      name: 'Test Venue',
      code: 'VW-SCHEDULE01',
      latitude: 40.7,
      longitude: -74.0,
      geofenceRadiusM: 100,
      timezone: 'America/New_York',
    },
  });

  const [profileA, profileB] = await Promise.all([
    prisma.profile.create({
      data: {
        email: 'alice@test.local',
        fullName: 'Alice Test',
        role: 'staff',
        jobTitle: 'Server',
        venueId: venue.id,
      },
    }),
    prisma.profile.create({
      data: {
        email: 'bob@test.local',
        fullName: 'Bob Test',
        role: 'staff',
        jobTitle: 'Server',
        venueId: venue.id,
      },
    }),
  ]);

  const openShift = await prisma.scheduleShift.create({
    data: {
      venueId: venue.id,
      profileId: null,
      dayIndex: 1,
      startMinutes: 600,
      endMinutes: 900,
      jobTitle: 'Server',
      station: 'Floor',
      status: 'open',
    },
  });

  return { venue, profileA, profileB, openShift };
}

/**
 * Delete all rows from scheduling-related tables in reverse FK order.
 */
export async function cleanSchedulingData(prisma: PrismaClient) {
  await prisma.shiftSwap.deleteMany();
  await prisma.scheduleShift.deleteMany();
  await prisma.profile.deleteMany();
  await prisma.venue.deleteMany();
}
