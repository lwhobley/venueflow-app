import { Module } from '@nestjs/common';
import { BillingModule } from '../../billing/billing.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ChatController } from './chat.controller';

@Module({
  imports: [PrismaModule, BillingModule],
  controllers: [ChatController],
})
export class ChatModule {}
