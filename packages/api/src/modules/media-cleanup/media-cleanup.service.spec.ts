import { describe, expect, it, vi } from 'vitest';
import { MediaCleanupService } from './media-cleanup.service';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('@aws-sdk/client-s3', () => ({
  DeleteObjectCommand: class DeleteObjectCommand {
    constructor(readonly input: unknown) {}
  },
  S3Client: class S3Client {
    send = sendMock;
  },
}));

const config = {
  get: vi.fn((_key: string, fallback?: string) => fallback),
  getOrThrow: vi.fn((key: string) => key === 'AWS_S3_BUCKET' ? 'test-bucket' : 'test-credential'),
};

describe('MediaCleanupService', () => {
  it('claims a durable job, deletes every unique object, and records completion', async () => {
    sendMock.mockReset().mockResolvedValue({});
    const prisma = {
      objectDeletionJob: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({ id: 'job-1', objectKeys: ['a.jpg', 'a.jpg', 'b.jpg'] }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const service = new MediaCleanupService(prisma as never, config as never);

    await expect(service.processJob('job-1')).resolves.toBe(true);

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(prisma.objectDeletionJob.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job-1' },
      data: expect.objectContaining({ status: 'completed' }),
    }));
  });

  it('leaves a failed job retryable when object storage rejects deletion', async () => {
    sendMock.mockReset().mockRejectedValue(new Error('storage unavailable'));
    const prisma = {
      objectDeletionJob: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({ id: 'job-2', objectKeys: ['a.jpg'] }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const service = new MediaCleanupService(prisma as never, config as never);

    await expect(service.processJob('job-2')).resolves.toBe(false);
    expect(prisma.objectDeletionJob.update).toHaveBeenCalledWith({
      where: { id: 'job-2' },
      data: { status: 'failed', lastError: 'storage unavailable' },
    });
  });
});
