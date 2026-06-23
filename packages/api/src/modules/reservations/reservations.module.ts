import { Module } from '@nestjs/common';
import { BillingModule } from '../../billing/billing.module';
import { EmailModule } from '../../email/email.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ReservationsController } from './reservations.controller';
import { ReservationNotifierService } from './reservation-notifier.service';

@Module({
  imports: [PrismaModule, BillingModule, EmailModule],
  controllers: [ReservationsController],
  providers: [ReservationNotifierService],
  exports: [ReservationNotifierService],
})
export class ReservationsModule {}
