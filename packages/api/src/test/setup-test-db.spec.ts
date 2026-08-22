import { describe, expect, it } from 'vitest';
import { assertDisposableTestDatabase } from './setup-test-db';

describe('assertDisposableTestDatabase', () => {
  it('accepts a clearly named local test database', () => {
    expect(() => assertDisposableTestDatabase(
      'postgresql://postgres:postgres@localhost:5432/venuetest_integration',
      {},
    )).not.toThrow();
  });

  it('rejects production execution', () => {
    expect(() => assertDisposableTestDatabase(
      'postgresql://postgres:postgres@localhost:5432/venuetest',
      { NODE_ENV: 'production' },
    )).toThrow('NODE_ENV=production');
  });

  it('rejects a target matching either runtime database', () => {
    const target = 'postgresql://postgres:postgres@localhost:5432/venuetest';
    expect(() => assertDisposableTestDatabase(target, { DATABASE_URL: target })).toThrow('matches DATABASE_URL');
  });

  it('rejects an ambiguously named local database', () => {
    expect(() => assertDisposableTestDatabase(
      'postgresql://postgres:postgres@localhost:5432/venuewrangler',
      {},
    )).toThrow('without a test marker');
  });

  it('rejects production-style names that merely begin with a test marker', () => {
    expect(() => assertDisposableTestDatabase(
      'postgresql://postgres:postgres@localhost:5432/integration_prod',
      {},
    )).toThrow('without a test marker');
  });

  it('requires both opt-in and an exact fingerprint for a remote database', () => {
    const target = 'postgresql://user:secret@ep-example.neon.tech:5432/venue_test';
    expect(() => assertDisposableTestDatabase(target, {})).toThrow('ALLOW_REMOTE_TEST_DB_RESET');
    expect(() => assertDisposableTestDatabase(target, {
      ALLOW_REMOTE_TEST_DB_RESET: 'true',
      TEST_DATABASE_FINGERPRINT: 'wrong-host:5432/venue_test',
    })).toThrow('fingerprint');
    expect(() => assertDisposableTestDatabase(target, {
      ALLOW_REMOTE_TEST_DB_RESET: 'true',
      TEST_DATABASE_FINGERPRINT: 'ep-example.neon.tech:5432/venue_test',
    })).not.toThrow();
  });
});
