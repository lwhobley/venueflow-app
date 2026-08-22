import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { MediaCleanupService } from './media-cleanup.service';

@Module({
  imports: [PrismaModule, ConfigModule],
  providers: [MediaCleanupService],
  exports: [MediaCleanupService],
})
export class MediaCleanupModule {}
