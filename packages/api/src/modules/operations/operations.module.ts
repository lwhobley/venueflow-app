import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { BillingModule } from '../../billing/billing.module';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [PrismaModule, BillingModule, ChatModule],
  controllers: [OperationsController],
})
export class OperationsModule {}
