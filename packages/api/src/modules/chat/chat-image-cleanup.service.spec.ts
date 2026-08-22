import { describe, expect, it, vi } from 'vitest';
import { ChatImageCleanupService } from './chat-image-cleanup.service';

describe('ChatImageCleanupService', () => {
  it('durably queues and immediately processes abandoned uploads', async () => {
    const tx = {
      chatImage: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        delete: vi.fn().mockResolvedValue({}),
      },
      objectDeletionJob: {
        create: vi.fn().mockResolvedValue({ id: 'job-1' }),
      },
    };
    const prisma = {
      chatImage: {
        findMany: vi.fn().mockResolvedValue([{ id: 'image-1', s3Key: 'chat/image-1.jpg' }]),
      },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const mediaCleanup = { processJob: vi.fn().mockResolvedValue(true) };
    const service = new ChatImageCleanupService(prisma as never, mediaCleanup as never);

    await expect(service.purgeAbandonedImages()).resolves.toBe(1);

    expect(prisma.chatImage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ messageId: null, purgeStartedAt: null }),
    }));
    expect(tx.objectDeletionJob.create).toHaveBeenCalledWith({
      data: { objectKeys: ['chat/image-1.jpg'] },
      select: { id: true },
    });
    expect(mediaCleanup.processJob).toHaveBeenCalledWith('job-1');
  });

  it('does not queue an upload another worker or message claimed first', async () => {
    const tx = {
      chatImage: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        delete: vi.fn(),
      },
      objectDeletionJob: { create: vi.fn() },
    };
    const prisma = {
      chatImage: { findMany: vi.fn().mockResolvedValue([{ id: 'image-1', s3Key: 'chat/image-1.jpg' }]) },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const mediaCleanup = { processJob: vi.fn() };
    const service = new ChatImageCleanupService(prisma as never, mediaCleanup as never);

    await expect(service.purgeAbandonedImages()).resolves.toBe(0);
    expect(tx.objectDeletionJob.create).not.toHaveBeenCalled();
    expect(tx.chatImage.delete).not.toHaveBeenCalled();
    expect(mediaCleanup.processJob).not.toHaveBeenCalled();
  });
});
