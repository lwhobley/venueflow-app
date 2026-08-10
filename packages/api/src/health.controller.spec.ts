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

  it('pings the database before reporting healthy', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const controller = new HealthController(prisma as any);

    const result = await controller.health();

    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    expect(result.service).toBe('venue-wrangler-api');
    expect(typeof result.time).toBe('string');
  });
});
