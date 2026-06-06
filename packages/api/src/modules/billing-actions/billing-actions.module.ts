import { Module } from '@nestjs/common';
import { BillingActionsController } from './billing-actions.controller';

@Module({
  controllers: [BillingActionsController],
})
export class BillingActionsModule {}
