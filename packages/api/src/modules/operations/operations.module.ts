import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { BillingModule } from '../../billing/billing.module';

@Module({
  imports: [PrismaModule, BillingModule],
  controllers: [OperationsController],
})
export class OperationsModule {}
