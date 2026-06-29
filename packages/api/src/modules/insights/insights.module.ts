import { Module } from '@nestjs/common';
import { InsightsController } from './insights.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { BillingModule } from '../../billing/billing.module';

@Module({
  imports: [PrismaModule, BillingModule],
  controllers: [InsightsController],
})
export class InsightsModule {}
