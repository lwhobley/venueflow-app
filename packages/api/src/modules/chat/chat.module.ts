import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BillingModule } from '../../billing/billing.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ChatController } from './chat.controller';
import { MediaAccessService } from './media-access.service';
import { S3ImageService } from './s3-image.service';
import { MediaCleanupModule } from '../media-cleanup/media-cleanup.module';
import { DocumentsModule } from '../documents/documents.module';
import { ChatImageCleanupService } from './chat-image-cleanup.service';

@Module({
  imports: [PrismaModule, BillingModule, ConfigModule, MediaCleanupModule, DocumentsModule],
  controllers: [ChatController],
  providers: [MediaAccessService, S3ImageService, ChatImageCleanupService],
  exports: [MediaAccessService, S3ImageService],
})
export class ChatModule {}
