import { Module } from '@nestjs/common';
import { BillingModule } from '../../billing/billing.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { FloorController } from './floor.controller';

@Module({
  imports: [PrismaModule, BillingModule],
  controllers: [FloorController],
})
export class FloorModule {}
