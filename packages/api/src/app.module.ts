import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AuthGuard } from './auth/auth.guard';
import { AuthController } from './auth/auth.controller';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { HealthController } from './health.controller';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { VenueModule } from './venue/venue.module';
import { VenueScopeInterceptor } from './venue/venue-scope.interceptor';
import { AppController } from './modules/app/app.controller';
import { CompatibilityController } from './modules/compatibility/compatibility.controller';
import { StaffController } from './modules/staff/staff.controller';
import { StaffRequestsController } from './modules/staff-requests/staff-requests.controller';
import { TimeClockController } from './modules/time-clock/time-clock.controller';
import { SchedulingController } from './modules/scheduling/scheduling.controller';
import { PosModule } from './modules/pos/pos.module';
import { BarInventoryModule } from './modules/bar-inventory/bar-inventory.module';
import { OperationsModule } from './modules/operations/operations.module';
import { InsightsModule } from './modules/insights/insights.module';
import { GuestsModule } from './modules/guests/guests.module';
import { ReservationsModule } from './modules/reservations/reservations.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { FloorModule } from './modules/floor/floor.module';
import { ChatModule } from './modules/chat/chat.module';
import { CrmModule } from './modules/crm/crm.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { BillingActionsModule } from './modules/billing-actions/billing-actions.module';

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
    PosModule,
    BarInventoryModule,
    OperationsModule,
    InsightsModule,
    GuestsModule,
    ReservationsModule,
    PayrollModule,
    FloorModule,
    ChatModule,
    CrmModule,
    IntegrationsModule,
    BillingActionsModule,
  ],
  controllers: [
    HealthController,
    AuthController,
    AppController,
    CompatibilityController,
    SchedulingController,
    TimeClockController,
    StaffRequestsController,
    StaffController,
  ],
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
