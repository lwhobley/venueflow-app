import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BillingModule } from '../../billing/billing.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ChatController } from './chat.controller';
import { MediaAccessService } from './media-access.service';
import { S3ImageService } from './s3-image.service';

@Module({
  imports: [PrismaModule, BillingModule, ConfigModule],
  controllers: [ChatController],
  providers: [MediaAccessService, S3ImageService],
  exports: [MediaAccessService, S3ImageService],
})
export class ChatModule {}
