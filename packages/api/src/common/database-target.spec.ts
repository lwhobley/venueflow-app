import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs guard shared with the CLI scripts, no types.
import { assertAllowedHost, assertNotProduction } from '../../scripts/database-target.mjs';

const PROD = 'postgresql://u:p@db.abc123.supabase.co:5432/postgres';
const BRANCH = 'postgresql://u:p@db.dev999.supabase.co:5432/postgres';
const LOCAL = 'postgresql://u:p@localhost:5432/venuewrangler';
const FINGERPRINT = 'db.abc123.supabase.co/postgres';

describe('assertNotProduction', () => {
  it('refuses the production database without an explicit opt-in', () => {
    expect(() => assertNotProduction('DATABASE_URL', PROD, { PRODUCTION_DB_FINGERPRINT: FINGERPRINT }))
      .toThrow(/production database/);
  });

  it('allows the production database when the operator opts in', () => {
    expect(() => assertNotProduction('DATABASE_URL', PROD, {
      PRODUCTION_DB_FINGERPRINT: FINGERPRINT,
      ALLOW_PRODUCTION_DB: 'true',
    })).not.toThrow();
  });

  it('allows a dev branch on the same vendor', () => {
    // The whole point: a vendor-suffix check cannot separate these two.
    expect(() => assertNotProduction('DATABASE_URL', BRANCH, { PRODUCTION_DB_FINGERPRINT: FINGERPRINT }))
      .not.toThrow();
  });

  it('is inert when no fingerprint is configured', () => {
    expect(() => assertNotProduction('DATABASE_URL', PROD, {})).not.toThrow();
  });

  it('matches the database name, not just the host', () => {
    const otherDatabase = 'postgresql://u:p@db.abc123.supabase.co:5432/shadow';
    expect(() => assertNotProduction('DATABASE_URL', otherDatabase, { PRODUCTION_DB_FINGERPRINT: FINGERPRINT }))
      .not.toThrow();
  });

  it('ignores case and surrounding whitespace in the configured fingerprint', () => {
    expect(() => assertNotProduction('DATABASE_URL', PROD, {
      PRODUCTION_DB_FINGERPRINT: `  DB.ABC123.Supabase.CO/postgres  `,
    })).toThrow(/production database/);
  });

  it('treats any value other than the literal "true" as no opt-in', () => {
    expect(() => assertNotProduction('DATABASE_URL', PROD, {
      PRODUCTION_DB_FINGERPRINT: FINGERPRINT,
      ALLOW_PRODUCTION_DB: 'yes',
    })).toThrow(/production database/);
  });
});

describe('assertAllowedHost', () => {
  it('accepts Supabase and local Postgres', () => {
    expect(() => assertAllowedHost('DATABASE_URL', PROD)).not.toThrow();
    expect(() => assertAllowedHost('DATABASE_URL', LOCAL)).not.toThrow();
  });

  it('rejects an unrelated host', () => {
    expect(() => assertAllowedHost('DATABASE_URL', 'postgresql://u:p@evil.example.com:5432/x'))
      .toThrow(/expected Supabase or local Postgres/);
  });
});
