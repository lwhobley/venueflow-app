import { Module } from '@nestjs/common';
import { PosController } from './pos.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { BillingModule } from '../../billing/billing.module';

@Module({ imports: [PrismaModule, BillingModule], controllers: [PosController] })
export class PosModule {}
