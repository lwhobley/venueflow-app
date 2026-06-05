import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { SubscriptionGuard } from './billing/subscription.guard';
import { HealthController } from './health.controller';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { VenueModule } from './venue/venue.module';
import { VenueScopeGuard } from './venue/venue-scope.guard';
import { AppController } from './modules/app/app.controller';
import { CompatibilityController } from './modules/compatibility/compatibility.controller';
import { StaffController } from './modules/staff/staff.controller';
import { StaffRequestsController } from './modules/staff-requests/staff-requests.controller';
import { TimeClockController } from './modules/time-clock/time-clock.controller';

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
    NotificationsModule,
  ],
  controllers: [
    HealthController,
    AppController,
    CompatibilityController,
    TimeClockController,
    StaffRequestsController,
    StaffController,
  ],
  providers: [
    // Guard 1: protect every route by default. Opt out with @Public().
    { provide: APP_GUARD, useExisting: AuthGuard },
    // Guard 2: resolve profile+venue and attach to request.venueScope.
    { provide: APP_GUARD, useClass: VenueScopeGuard },
    // Guard 3: enforce subscription tier when @RequireSubscription() is present.
    { provide: APP_GUARD, useClass: SubscriptionGuard },
    Reflector,
  ],
})
export class AppModule {}
