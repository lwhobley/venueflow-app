import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { BillingModule } from '../../billing/billing.module';
import { ChatModule } from '../chat/chat.module';
import { ExecutionAutopilotService } from './execution-autopilot.service';

@Module({
  imports: [PrismaModule, BillingModule, ChatModule],
  controllers: [OperationsController],
  providers: [ExecutionAutopilotService],
  exports: [ExecutionAutopilotService],
})
export class OperationsModule {}
