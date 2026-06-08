import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { SubscriptionGuard } from './subscription.guard';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [BillingController],
  providers: [SubscriptionGuard],
  exports: [SubscriptionGuard],
})
export class BillingModule {}
