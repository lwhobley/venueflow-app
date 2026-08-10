import { describe, expect, it, vi } from 'vitest';
import { tryAcquireSharedLease } from './shared-lease';

describe('tryAcquireSharedLease', () => {
  it('reports whether Postgres inserted or renewed the lease', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValueOnce([{ key: 'lease:chat' }]).mockResolvedValueOnce([]) } as any;

    await expect(tryAcquireSharedLease(prisma, 'chat', 60_000, new Date('2026-08-10T00:00:00Z'))).resolves.toBe(true);
    await expect(tryAcquireSharedLease(prisma, 'chat', 60_000, new Date('2026-08-10T00:00:01Z'))).resolves.toBe(false);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
