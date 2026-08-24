import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns a static root payload', () => {
    const controller = new HealthController({} as any);
    expect(controller.root()).toEqual({
      message: 'Venue Wrangler API is running',
      health: '/api/health',
    });
  });

  it('returns lightweight liveness without database queries', () => {
    const prisma = { $queryRaw: vi.fn() };
    const controller = new HealthController(prisma as any);
    const result = controller.liveness();
    expect(result.ok).toBe(true);
    expect(result.status).toBe('live');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('pings the database before reporting healthy and caches consecutive calls', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const controller = new HealthController(prisma as any);

    const result1 = await controller.health();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result1.ok).toBe(true);
    expect(result1.service).toBe('venue-wrangler-api');

    // Second immediate call uses the cached health status within the 15s window
    const result2 = await controller.health();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result2.ok).toBe(true);
  });

  it('shares in-flight database check across simultaneous concurrent requests', async () => {
    let resolveQuery: (value: any) => void = () => {};
    const queryPromise = new Promise((resolve) => {
      resolveQuery = resolve;
    });
    const prisma = { $queryRaw: vi.fn().mockImplementation(() => queryPromise) };
    const controller = new HealthController(prisma as any);

    // Launch multiple concurrent health requests simultaneously while uncached
    const concurrentRequests = Promise.all([
      controller.health(),
      controller.health(),
      controller.health(),
      controller.health(),
    ]);

    resolveQuery([{ '?column?': 1 }]);
    const results = await concurrentRequests;

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(4);
    for (const r of results) {
      expect(r.ok).toBe(true);
    }
  });
});
