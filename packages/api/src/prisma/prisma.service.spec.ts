import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_DATABASE_POOL_SIZE,
  DEFAULT_DATABASE_POOL_TIMEOUT_SECONDS,
  databasePoolSize,
  resolveDatabaseUrl,
} from './prisma.service';

const originalPoolSize = process.env.DATABASE_POOL_SIZE;
const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (originalPoolSize === undefined) delete process.env.DATABASE_POOL_SIZE;
  else process.env.DATABASE_POOL_SIZE = originalPoolSize;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe('Prisma connection-pool configuration', () => {
  it('uses a conservative default pool size', () => {
    delete process.env.DATABASE_POOL_SIZE;
    expect(databasePoolSize()).toBe(DEFAULT_DATABASE_POOL_SIZE);
  });

  it('falls back safely for invalid pool values', () => {
    expect(databasePoolSize('0')).toBe(DEFAULT_DATABASE_POOL_SIZE);
    expect(databasePoolSize('not-a-number')).toBe(DEFAULT_DATABASE_POOL_SIZE);
  });

  it('adds a bounded pool and timeout without overriding explicit URL values', () => {
    process.env.DATABASE_POOL_SIZE = '4';
    expect(resolveDatabaseUrl('postgresql://user:pass@example.test:5432/db?sslmode=require'))
      .toBe('postgresql://user:pass@example.test:5432/db?sslmode=require&connection_limit=4&pool_timeout=10');
    expect(resolveDatabaseUrl('postgresql://user:pass@example.test:5432/db?connection_limit=8&pool_timeout=20'))
      .toBe('postgresql://user:pass@example.test:5432/db?connection_limit=8&pool_timeout=20');
    expect(DEFAULT_DATABASE_POOL_TIMEOUT_SECONDS).toBe(10);
  });
});
