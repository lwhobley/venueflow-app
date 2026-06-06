import { Module } from '@nestjs/common';
import { BillingModule } from '../../billing/billing.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { GuestsController } from './guests.controller';

@Module({ imports: [PrismaModule, BillingModule], controllers: [GuestsController] })
export class GuestsModule {}
