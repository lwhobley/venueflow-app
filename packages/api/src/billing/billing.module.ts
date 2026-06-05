import { Module } from '@nestjs/common';
import { SubscriptionGuard } from './subscription.guard';

@Module({
  providers: [SubscriptionGuard],
  exports: [SubscriptionGuard],
})
export class BillingModule {}
