import { Module } from '@nestjs/common';
import { BillingModule } from '../../billing/billing.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ChatController } from './chat.controller';
import { MediaAccessService } from './media-access.service';
import { S3ImageService } from './s3-image.service';

@Module({
  imports: [PrismaModule, BillingModule],
  controllers: [ChatController],
  providers: [MediaAccessService, S3ImageService],
  exports: [MediaAccessService, S3ImageService],
})
export class ChatModule {}
