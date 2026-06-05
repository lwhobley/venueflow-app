import { Module } from '@nestjs/common';
import { SubscriptionGuard } from './subscription.guard';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [SubscriptionGuard],
  exports: [SubscriptionGuard],
})
export class BillingModule {}
