import { readFileSync } from 'node:fs';
import { assertAllowedHost, assertNotProduction } from './database-target.mjs';

function localDatabaseValue(key) {
  try {
    const line = readFileSync('.env', 'utf8')
      .split(/\r?\n/)
      .find((candidate) => candidate.startsWith(`${key}=`));
    return line?.slice(key.length + 1).trim().replace(/^"|"$/g, '');
  } catch {
    return undefined;
  }
}

const databaseUrl = process.env.DATABASE_URL ?? localDatabaseValue('DATABASE_URL');
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for database commands.');
}

const directUrl = process.env.DATABASE_DIRECT_URL ?? localDatabaseValue('DATABASE_DIRECT_URL');

// schema.prisma declares `directUrl = env("DATABASE_DIRECT_URL")`, and Prisma
// Migrate resolves it for every migrate/studio command. Serving instances
// deliberately do NOT carry that higher-privilege credential (see
// validate-env.ts), so only assert it for the commands that actually migrate —
// otherwise a missing value surfaces as an opaque Prisma P1012 from inside a
// Cloud Run job instead of a clear message here.
const MIGRATE_COMMANDS = new Set(['release', 'prisma:migrate:dev', 'prisma:migrate:deploy', 'prisma:migrate:status', 'prisma:studio']);
if (MIGRATE_COMMANDS.has(process.env.npm_lifecycle_event ?? '') && !directUrl) {
  throw new Error(
    'DATABASE_DIRECT_URL is required for migration commands. Prisma Migrate uses the direct ' +
      '(non-pooled) connection declared as `directUrl` in prisma/schema.prisma.',
  );
}

for (const [key, value] of [
  ['DATABASE_URL', databaseUrl],
  ['DATABASE_DIRECT_URL', directUrl],
]) {
  if (!value) continue;
  assertAllowedHost(key, value);
  assertNotProduction(key, value);
}
