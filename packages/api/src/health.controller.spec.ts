import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports the API root without touching the database', () => {
    const controller = new HealthController({} as any);
    expect(controller.root()).toEqual({
      message: 'Venue Wrangler API is running',
      health: '/api/health',
    });
  });

  it('checks database connectivity for health requests', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
    const controller = new HealthController({ $queryRaw: queryRaw } as any);

    await expect(controller.health()).resolves.toEqual(expect.objectContaining({
      ok: true,
      service: 'venue-wrangler-api',
      time: expect.any(String),
    }));
    expect(queryRaw).toHaveBeenCalledOnce();
  });
});
