import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { BillingModule } from '../../billing/billing.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { ChatModule } from '../chat/chat.module';
import { ExecutionAutopilotService } from './execution-autopilot.service';
import { WranglerController } from './wrangler/wrangler.controller';
import { WranglerHistoryService } from './wrangler/wrangler-history.service';
import { WranglerOperatorController } from './wrangler/wrangler-operator.controller';
import { WranglerOperatorService } from './wrangler/wrangler-operator.service';
import { WranglerService } from './wrangler/wrangler.service';

@Module({
  imports: [PrismaModule, BillingModule, NotificationsModule, ChatModule],
  controllers: [OperationsController, WranglerController, WranglerOperatorController],
  providers: [ExecutionAutopilotService, WranglerService, WranglerHistoryService, WranglerOperatorService],
  exports: [ExecutionAutopilotService, WranglerService, WranglerHistoryService, WranglerOperatorService],
})
export class OperationsModule {}
