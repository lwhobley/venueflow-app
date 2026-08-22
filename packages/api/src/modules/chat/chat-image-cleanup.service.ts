import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { runWithoutTenant } from '../../prisma/tenant-context';
import { MediaCleanupService } from '../media-cleanup/media-cleanup.service';

const ORPHAN_GRACE_MS = 60 * 60 * 1000;

@Injectable()
export class ChatImageCleanupService {
  constructor(private readonly prisma: PrismaService, private readonly mediaCleanup: MediaCleanupService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async purgeAbandonedImages(): Promise<number> {
    const cutoff = new Date(Date.now() - ORPHAN_GRACE_MS);
    const candidates = await runWithoutTenant(() => this.prisma.chatImage.findMany({
      where: { messageId: null, purgeStartedAt: null, createdAt: { lt: cutoff } },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: { id: true, s3Key: true },
    }));

    let queued = 0;
    for (const candidate of candidates) {
      const jobId = await runWithoutTenant(() => this.prisma.$transaction(async (tx) => {
        const claimed = await tx.chatImage.updateMany({
          where: { id: candidate.id, messageId: null, purgeStartedAt: null },
          data: { purgeStartedAt: new Date() },
        });
        if (claimed.count !== 1) return null;
        const job = await tx.objectDeletionJob.create({
          data: { objectKeys: [candidate.s3Key] },
          select: { id: true },
        });
        await tx.chatImage.delete({ where: { id: candidate.id } });
        return job.id;
      }));
      if (!jobId) continue;
      queued += 1;
      await this.mediaCleanup.processJob(jobId);
    }
    return queued;
  }
}
