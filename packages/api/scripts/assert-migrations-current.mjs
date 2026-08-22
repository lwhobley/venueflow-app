import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');
const expected = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const prisma = new PrismaClient();
try {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
  );
  const applied = new Set(rows.map((row) => String(row.migration_name)));
  const missing = expected.filter((name) => !applied.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Database schema is behind this release. Run the migration job before serving traffic. Missing: ${missing.join(', ')}`,
    );
  }
  console.log(`Database migration preflight passed (${expected.length} migrations applied).`);
} finally {
  await prisma.$disconnect();
}
