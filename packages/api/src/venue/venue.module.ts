import { Module } from '@nestjs/common';
import { VenueScopeGuard } from './venue-scope.guard';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [VenueScopeGuard],
  exports: [VenueScopeGuard],
})
export class VenueModule {}
