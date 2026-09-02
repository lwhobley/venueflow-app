import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { BillingModule } from '../../billing/billing.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { ChatModule } from '../chat/chat.module';
import { DocumentsModule } from '../documents/documents.module';
import { ExecutionAutopilotService } from './execution-autopilot.service';
import { WranglerController } from './wrangler/wrangler.controller';
import { WranglerHistoryService } from './wrangler/wrangler-history.service';
import { WranglerService } from './wrangler/wrangler.service';

@Module({
  imports: [PrismaModule, BillingModule, NotificationsModule, ChatModule, DocumentsModule],
  controllers: [OperationsController, WranglerController],
  providers: [ExecutionAutopilotService, WranglerService, WranglerHistoryService],
  exports: [ExecutionAutopilotService, WranglerService, WranglerHistoryService],
})
export class OperationsModule {}
