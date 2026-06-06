import { Module } from '@nestjs/common';
import { BarInventoryController } from './bar-inventory.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { BillingModule } from '../../billing/billing.module';

@Module({
  imports: [PrismaModule, BillingModule],
  controllers: [BarInventoryController],
})
export class BarInventoryModule {}
