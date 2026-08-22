import { Module } from '@nestjs/common';
import { BillingModule } from '../../billing/billing.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { MediaCleanupModule } from '../media-cleanup/media-cleanup.module';
import { DocumentsController } from './documents.controller';
import { S3DocumentService } from './s3-document.service';

@Module({
  imports: [PrismaModule, BillingModule, MediaCleanupModule],
  controllers: [DocumentsController],
  providers: [S3DocumentService],
})
export class DocumentsModule {}
