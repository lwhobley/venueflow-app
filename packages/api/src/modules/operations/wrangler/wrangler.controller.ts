import { BadRequestException, Body, Controller, ForbiddenException, Get, Post } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { isAdminRole } from '../../../auth/roles';
import { RequireSubscription } from '../../../billing/require-subscription.decorator';
import { NotificationsService } from '../../../notifications/notifications.service';
import { VenueScope } from '../../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../../venue/venue-scope.interceptor';
import { PrismaService } from '../../../prisma/prisma.service';
import { WranglerHistoryService } from './wrangler-history.service';
import { WranglerService } from './wrangler.service';

type Scope = VenueScopedRequest['venueScope'];

class ExecuteWranglerActionDto {
  @IsString()
  @IsIn(['REASSIGN_RESERVATION', 'NOTIFY_STAFF'])
  type!: 'REASSIGN_RESERVATION' | 'NOTIFY_STAFF';
  @IsOptional() @IsString() reservationId?: string;
  @IsOptional() @IsString() tableId?: string;
}

class AskWranglerDto {
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  question!: string;
}

@Controller('v1/operations/wrangler')
export class WranglerController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wrangler: WranglerService,
    private readonly notifications: NotificationsService,
    private readonly history: WranglerHistoryService,
  ) {}

  @RequireSubscription('active')
  @Get()
  async getWrangler(@VenueScope() scope: Scope) {
    if (!scope) return null;
    const venue = await this.prisma.venue.findUnique({ where: { id: scope.venueId }, select: { id: true, name: true, timezone: true } });
    if (!venue) return null;
    const snapshot = await this.wrangler.getSnapshot(venue.id, venue.timezone);
    const historicalPatterns = await this.history.getPatterns({ venueId: venue.id, timezone: venue.timezone, nowMs: snapshot.generatedAt, todayCovers: snapshot.summary.covers, todayReservations: snapshot.summary.reservations });
    return { venue: { _id: venue.id, name: venue.name }, ...snapshot, patterns: [...snapshot.patterns, ...historicalPatterns].slice(0, 6) };
  }

  @RequireSubscription('active')
  @Post('ask')
  async askWrangler(@VenueScope() scope: Scope, @Body() body: AskWranglerDto) {
    if (!scope) return null;
    const venue = await this.prisma.venue.findUnique({ where: { id: scope.venueId }, select: { timezone: true } });
    if (!venue) return null;
    return this.wrangler.ask(scope.venueId, venue.timezone, body.question);
  }

  @RequireSubscription('active')
  @Post('actions')
  async executeAction(@VenueScope() scope: Scope, @Body() body: ExecuteWranglerActionDto) {
    if (!scope) return null;
    if (!isAdminRole(scope.role)) throw new ForbiddenException('Manager access required to execute Wrangler actions');

    if (body.type === 'NOTIFY_STAFF') {
      const venue = await this.prisma.venue.findUnique({ where: { id: scope.venueId }, select: { timezone: true } });
      if (!venue) throw new BadRequestException('Venue not found');
      const snapshot = await this.wrangler.getSnapshot(scope.venueId, venue.timezone);
      if (snapshot.summary.openShifts <= 0) throw new BadRequestException('No open shifts currently need coverage');
      const count = snapshot.summary.openShifts;
      await this.notifications.notifyStaff({ venueId: scope.venueId, kind: 'wrangler_coverage', title: 'Open shifts need coverage', body: `${count} open shift${count === 1 ? '' : 's'} still need coverage. Check Venue Wrangler for available shifts.` });
      return { ok: true, type: body.type, notified: 'staff', openShifts: count };
    }

    return this.wrangler.executeAction(scope.venueId, { type: body.type, reservationId: body.reservationId, tableId: body.tableId });
  }
}
