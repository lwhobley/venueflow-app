import { Module } from '@nestjs/common';
import { BarInventoryController } from './bar-inventory.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { BillingModule } from '../../billing/billing.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { EmailModule } from '../../email/email.module';

@Module({
  imports: [PrismaModule, BillingModule, NotificationsModule, EmailModule],
  controllers: [BarInventoryController],
})
export class BarInventoryModule {}
