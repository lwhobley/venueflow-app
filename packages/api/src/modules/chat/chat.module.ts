import { Module } from '@nestjs/common';
import { BillingModule } from '../../billing/billing.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ChatController } from './chat.controller';
import { S3ImageService } from './s3-image.service';

@Module({
  imports: [PrismaModule, BillingModule],
  controllers: [ChatController],
  providers: [S3ImageService],
  exports: [S3ImageService],
})
export class ChatModule {}
