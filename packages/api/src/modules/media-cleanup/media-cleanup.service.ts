import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { runWithoutTenant } from '../../prisma/tenant-context';

@Injectable()
export class MediaCleanupService {
  private readonly logger = new Logger(MediaCleanupService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(private readonly prisma: PrismaService, config: ConfigService) {
    this.s3 = new S3Client({
      region: config.get<string>('AWS_REGION', 'us-east-1'),
      credentials: {
        accessKeyId: config.getOrThrow<string>('AWS_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow<string>('AWS_SECRET_ACCESS_KEY'),
      },
    });
    this.bucket = config.getOrThrow<string>('AWS_S3_BUCKET');
  }

  async processJob(id: string): Promise<boolean> {
    return runWithoutTenant(async () => {
      const claimed = await this.prisma.objectDeletionJob.updateMany({
        where: { id, status: { in: ['pending', 'failed'] } },
        data: { status: 'processing', attempts: { increment: 1 }, lastError: null },
      });
      if (claimed.count !== 1) return false;
      const job = await this.prisma.objectDeletionJob.findUnique({ where: { id } });
      if (!job) return false;

      try {
        for (const key of Array.from(new Set(job.objectKeys))) {
          await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
        }
        await this.prisma.objectDeletionJob.update({
          where: { id },
          data: { status: 'completed', completedAt: new Date(), lastError: null },
        });
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.prisma.objectDeletionJob.update({
          where: { id },
          data: { status: 'failed', lastError: message.slice(0, 1000) },
        });
        this.logger.error(`Object deletion job ${id} failed: ${message}`);
        return false;
      }
    });
  }

  @Cron(CronExpression.EVERY_HOUR)
  async retryPendingJobs(): Promise<void> {
    const abandonedCutoff = new Date(Date.now() - 15 * 60 * 1000);
    await runWithoutTenant(() => this.prisma.objectDeletionJob.updateMany({
      where: { status: 'processing', updatedAt: { lt: abandonedCutoff } },
      data: { status: 'failed', lastError: 'Worker stopped before completing object deletion.' },
    }));
    const jobs = await runWithoutTenant(() => this.prisma.objectDeletionJob.findMany({
      where: { status: { in: ['pending', 'failed'] } },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: { id: true },
    }));
    for (const job of jobs) await this.processJob(job.id);

    const retentionCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await runWithoutTenant(() => this.prisma.objectDeletionJob.deleteMany({
      where: { status: 'completed', completedAt: { lt: retentionCutoff } },
    }));
  }
}
