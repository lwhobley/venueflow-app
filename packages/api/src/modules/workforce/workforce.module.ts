import { Module } from '@nestjs/common';
import { EmailModule } from '../../email/email.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { WorkforceController } from './workforce.controller';

@Module({
  imports: [PrismaModule, EmailModule],
  controllers: [WorkforceController],
})
export class WorkforceModule {}
