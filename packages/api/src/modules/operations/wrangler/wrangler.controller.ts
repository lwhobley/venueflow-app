import { Body, Controller, ForbiddenException, Get, Post } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { isAdminRole } from '../../../auth/roles';
import { RequireSubscription } from '../../../billing/require-subscription.decorator';
import { VenueScope } from '../../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../../venue/venue-scope.interceptor';
import { PrismaService } from '../../../prisma/prisma.service';
import { WranglerService } from './wrangler.service';

type Scope = VenueScopedRequest['venueScope'];

class ExecuteWranglerActionDto {
  @IsString()
  @IsIn(['REASSIGN_RESERVATION'])
  type!: 'REASSIGN_RESERVATION';
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
  constructor(private readonly prisma: PrismaService, private readonly wrangler: WranglerService) {}

  @RequireSubscription('active')
  @Get()
  async getWrangler(@VenueScope() scope: Scope) {
    if (!scope) return null;
    const venue = await this.prisma.venue.findUnique({ where: { id: scope.venueId }, select: { id: true, name: true, timezone: true } });
    if (!venue) return null;
    const snapshot = await this.wrangler.getSnapshot(venue.id, venue.timezone);
    return { venue: { _id: venue.id, name: venue.name }, ...snapshot };
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
    return this.wrangler.executeAction(scope.venueId, body);
  }
}
