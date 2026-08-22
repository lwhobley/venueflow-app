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
        findUnique: vi.fn().mockResolvedValue({
          id: 'job-1',
          attempts: 0,
          objectKeys: [
            'chat/venue-1/0123456789abcdef0123456789abcdef',
            'chat/venue-1/0123456789abcdef0123456789abcdef',
            'documents/venue-1/fedcba9876543210fedcba9876543210',
          ],
        }),
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
        findUnique: vi.fn().mockResolvedValue({
          id: 'job-2', attempts: 0, objectKeys: ['chat/venue-1/0123456789abcdef0123456789abcdef'],
        }),
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

  it('parks unsafe keys without sending an S3 deletion request', async () => {
    sendMock.mockReset();
    const prisma = {
      objectDeletionJob: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({ id: 'job-3', attempts: 0, objectKeys: ['../../outside-prefix'] }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const service = new MediaCleanupService(prisma as never, config as never);

    await expect(service.processJob('job-3')).resolves.toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
    expect(prisma.objectDeletionJob.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'dead' }),
    }));
  });

  it('parks a repeatedly failing job after the retry cap', async () => {
    sendMock.mockReset().mockRejectedValue(new Error('storage unavailable'));
    const prisma = {
      objectDeletionJob: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({
          id: 'job-4', attempts: 9, objectKeys: ['chat/venue-1/0123456789abcdef0123456789abcdef'],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const service = new MediaCleanupService(prisma as never, config as never);

    await expect(service.processJob('job-4')).resolves.toBe(false);
    expect(prisma.objectDeletionJob.update).toHaveBeenCalledWith({
      where: { id: 'job-4' },
      data: { status: 'dead', lastError: 'storage unavailable' },
    });
  });
});
