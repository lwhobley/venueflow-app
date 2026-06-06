import { Module } from '@nestjs/common';
import { BillingModule } from '../../billing/billing.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PayrollController } from './payroll.controller';

@Module({ imports: [PrismaModule, BillingModule], controllers: [PayrollController] })
export class PayrollModule {}
