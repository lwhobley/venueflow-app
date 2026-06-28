import { Module } from '@nestjs/common';
import { BillingModule } from '../../billing/billing.module';
import { EmailModule } from '../../email/email.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { CrmController } from './crm.controller';
import { CrmTemplateService } from './crm-template.service';

@Module({
  imports: [PrismaModule, BillingModule, EmailModule],
  controllers: [CrmController],
  providers: [CrmTemplateService],
})
export class CrmModule {}
