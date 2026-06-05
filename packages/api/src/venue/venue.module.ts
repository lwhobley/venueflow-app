import { Module } from '@nestjs/common';
import { VenueScopeInterceptor } from './venue-scope.interceptor';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [VenueScopeInterceptor],
  exports: [VenueScopeInterceptor],
})
export class VenueModule {}
