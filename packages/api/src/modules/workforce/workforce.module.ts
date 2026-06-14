import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { WorkforceController } from './workforce.controller';

@Module({
  imports: [PrismaModule],
  controllers: [WorkforceController],
})
export class WorkforceModule {}
