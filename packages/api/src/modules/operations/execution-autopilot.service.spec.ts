import { describe, expect, it, vi } from 'vitest';
import { ExecutionAutopilotService } from './execution-autopilot.service';

describe('ExecutionAutopilotService', () => {
  it('uses stable template keys and duplicate-safe inserts', async () => {
    const prisma = {
      eventExecutionWorkspace: { upsert: vi.fn().mockResolvedValue({ id: 'workspace-1' }) },
      eventExecutionTask: { createMany: vi.fn().mockResolvedValue({ count: 3 }) },
      eventExecutionTimelineItem: { createMany: vi.fn().mockResolvedValue({ count: 3 }) },
      eventExecutionVendor: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    } as any;
    const service = new ExecutionAutopilotService(prisma);
    const input = {
      venueId: 'venue-1',
      sourceType: 'reservation' as const,
      sourceId: 'reservation-1',
      title: 'Launch Party',
      startsAt: new Date('2026-08-01T18:00:00Z'),
      endsAt: new Date('2026-08-01T22:00:00Z'),
      setupStyle: 'cocktail',
      vendorNames: ['Production Co', 'Production Co'],
    };

    await Promise.all([service.ensureWorkspace(input), service.ensureWorkspace(input)]);

    expect(prisma.eventExecutionWorkspace.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.eventExecutionTask.createMany).toHaveBeenCalledWith(expect.objectContaining({
      skipDuplicates: true,
      data: expect.arrayContaining([
        expect.objectContaining({ templateKey: 'event-brief' }),
        expect.objectContaining({ templateKey: 'room-setup' }),
        expect.objectContaining({ templateKey: 'staffing-coverage' }),
      ]),
    }));
    expect(prisma.eventExecutionTimelineItem.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    expect(prisma.eventExecutionVendor.createMany).toHaveBeenCalledWith(expect.objectContaining({
      skipDuplicates: true,
      data: [expect.objectContaining({ name: 'Production Co', templateKey: 'vendor-0' })],
    }));
  });

  it('does not create a synthetic vendor when no vendor data exists', async () => {
    const prisma = {
      eventExecutionWorkspace: { upsert: vi.fn().mockResolvedValue({ id: 'workspace-1' }) },
      eventExecutionTask: { createMany: vi.fn() },
      eventExecutionTimelineItem: { createMany: vi.fn() },
      eventExecutionVendor: { createMany: vi.fn() },
    } as any;
    const service = new ExecutionAutopilotService(prisma);

    await service.ensureWorkspace({
      venueId: 'venue-1', sourceType: 'beo', sourceId: 'beo-1', title: 'Gala',
      startsAt: new Date('2026-08-01T18:00:00Z'), endsAt: new Date('2026-08-01T22:00:00Z'),
    });

    expect(prisma.eventExecutionVendor.createMany).not.toHaveBeenCalled();
  });
});
