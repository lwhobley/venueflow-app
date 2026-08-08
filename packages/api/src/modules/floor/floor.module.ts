import { Module } from '@nestjs/common';
import { BillingModule } from '../../billing/billing.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { FloorController } from './floor.controller';
import { FloorService } from './floor.service';

@Module({
  imports: [PrismaModule, BillingModule, ReservationsModule],
  controllers: [FloorController],
  providers: [FloorService],
  exports: [FloorService],
})
export class FloorModule {}
