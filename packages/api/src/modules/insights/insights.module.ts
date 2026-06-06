import { Module } from '@nestjs/common';
import { InsightsController } from './insights.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [InsightsController],
})
export class InsightsModule {}
