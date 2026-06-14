import { Body, Controller, ForbiddenException, Get, Post } from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { IntegrationStatus, ReservationSource } from '@prisma/client';
import { isAdminRole } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';

type Scope = VenueScopedRequest['venueScope'];

const RESERVATION_SOURCES = ['direct', 'opentable', 'resy', 'phone', 'walk_in', 'sevenrooms', 'tock', 'google'] as const;
const INTEGRATION_STATUSES = ['connected', 'paused', 'error'] as const;

class UpsertReservationConnectionDto {
  @IsString()
  @IsIn(RESERVATION_SOURCES)
  provider!: ReservationSource;

  @IsString()
  @IsOptional()
  externalVenueId?: string;

  @IsString()
  @IsIn(INTEGRATION_STATUSES)
  status!: IntegrationStatus;
}

@Controller('v1/integrations')
export class IntegrationsController {
  constructor(private readonly prisma: PrismaService) {}

  @RequireSubscription('active')
  @Get('reservations')
  async getReservationIntegrationOverview(@VenueScope() scope: Scope) {
    if (!scope || !isAdminRole(scope.role)) {
      throw new ForbiddenException('Not authorized');
    }
    const [rawConnections, rawEvents] = await Promise.all([
      this.prisma.reservationConnection.findMany({ where: { venueId: scope.venueId } }),
      this.prisma.reservationSyncEvent.findMany({
        where: { venueId: scope.venueId },
        orderBy: { processedAt: 'desc' },
        take: 20,
      }),
    ]);
    const connections = rawConnections.map(({ id, webhookSecret: _, ...rest }) => ({ _id: id, ...rest }));
    const recentEvents = rawEvents.map(({ id, ...rest }) => ({ _id: id, ...rest }));
    return { connections, recentEvents };
  }

  @RequireSubscription('active')
  @Post('reservations')
  async upsertReservationConnection(@VenueScope() scope: Scope, @Body() body: UpsertReservationConnectionDto) {
    if (!scope || !isAdminRole(scope.role)) {
      throw new ForbiddenException('Not authorized');
    }
    const existing = await this.prisma.reservationConnection.findFirst({
      where: { venueId: scope.venueId, provider: body.provider },
      select: { id: true },
    });
    const mapConnection = ({ id, webhookSecret: _, ...rest }: any) => ({ _id: id, ...rest });
    if (existing) {
      const row = await this.prisma.reservationConnection.update({
        where: { id: existing.id },
        data: { externalVenueId: body.externalVenueId ?? null, status: body.status },
      });
      return mapConnection(row);
    }
    const row = await this.prisma.reservationConnection.create({
      data: {
        venueId: scope.venueId,
        provider: body.provider,
        externalVenueId: body.externalVenueId ?? null,
        status: body.status,
      },
    });
    return mapConnection(row);
  }
}
