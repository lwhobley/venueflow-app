import { Module } from '@nestjs/common';
import { BillingModule } from '../../billing/billing.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ReservationsController } from './reservations.controller';

@Module({ imports: [PrismaModule, BillingModule], controllers: [ReservationsController] })
export class ReservationsModule {}
