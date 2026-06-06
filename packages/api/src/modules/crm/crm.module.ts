import { Module } from '@nestjs/common';
import { BillingModule } from '../../billing/billing.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { CrmController } from './crm.controller';

@Module({
  imports: [PrismaModule, BillingModule],
  controllers: [CrmController],
})
export class CrmModule {}
