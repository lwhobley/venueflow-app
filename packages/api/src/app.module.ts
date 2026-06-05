import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { VenueModule } from './venue/venue.module';
import { VenueScopeInterceptor } from './venue/venue-scope.interceptor';
import { AppController } from './modules/app/app.controller';
import { CompatibilityController } from './modules/compatibility/compatibility.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['packages/api/.env.local', 'packages/api/.env', '.env.local', '.env'],
    }),
    PrismaModule,
    AuthModule,
    VenueModule,
    BillingModule,
  ],
  controllers: [HealthController, AppController, CompatibilityController],
  providers: [
    // Protect every route by default. Opt out explicitly with @Public().
    { provide: APP_GUARD, useExisting: AuthGuard },
    // Resolve profile+venue once per request and expose via request.venueScope.
    { provide: APP_INTERCEPTOR, useClass: VenueScopeInterceptor },
    // Reflector must be provided at the module level for the interceptor DI.
    Reflector,
  ],
})
export class AppModule {}
