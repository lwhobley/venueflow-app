import { Module } from '@nestjs/common';
import { BillingModule } from '../../billing/billing.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { FloorController } from './floor.controller';

@Module({
  imports: [PrismaModule, BillingModule, ReservationsModule],
  controllers: [FloorController],
})
export class FloorModule {}
