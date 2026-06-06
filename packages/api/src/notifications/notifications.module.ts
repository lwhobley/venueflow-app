import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PushController } from './push.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PushController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
