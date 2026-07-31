import { Module } from '@nestjs/common';
import { BillingModule } from '../../billing/billing.module';
import { EmailModule } from '../../email/email.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ReservationsController } from './reservations.controller';
import { ReservationMutationService } from './reservation-mutation.service';
import { ReservationNotifierService } from './reservation-notifier.service';
import { OperationsModule } from '../operations/operations.module';

@Module({
  imports: [PrismaModule, BillingModule, EmailModule, OperationsModule],
  controllers: [ReservationsController],
  providers: [ReservationNotifierService, ReservationMutationService],
  exports: [ReservationNotifierService],
})
export class ReservationsModule {}
