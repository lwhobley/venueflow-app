import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { IsArray, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { isAdminRole } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';

type Scope = VenueScopedRequest['venueScope'];

class SaveReservationDto {
  @IsString()
  @IsOptional()
  reservationId?: string;

  @IsString()
  guestName!: string;

  @IsInt()
  partySize!: number;

  @IsString()
  reservationTime!: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  source?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsString()
  @IsOptional()
  specialRequests?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tableNumbers?: string[];

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  email?: string;
}

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

@Controller('v1/reservations')
export class ReservationsController {
  constructor(private readonly prisma: PrismaService) {}

  private requireManager(scope: Scope): asserts scope is NonNullable<Scope> {
    if (!scope || !isAdminRole(scope.role)) throw new ForbiddenException('Not authorized');
  }

  @RequireSubscription('active')
  @Get()
  async getReservationsPage(
    @VenueScope() scope: Scope,
    @Query('date') date?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    this.requireManager(scope);
    const pageNum = parseInt(page ?? '0', 10) || 0;
    const limitNum = Math.min(parseInt(limit ?? '50', 10) || 50, 200);
    const where: Record<string, unknown> = {
      venueId: scope.venueId,
      deletedAt: null,
    };
    if (date) {
      const start = new Date(`${date}T00:00:00.000Z`);
      const end = new Date(`${date}T23:59:59.999Z`);
      where['reservationTime'] = { gte: start, lte: end };
    }
    if (status) {
      where['status'] = status;
    }
    const [reservations, totalCount] = await this.prisma.$transaction([
      this.prisma.reservation.findMany({
        where: where as any,
        orderBy: { reservationTime: 'asc' },
        skip: pageNum * limitNum,
        take: limitNum,
      }),
      this.prisma.reservation.count({ where: where as any }),
    ]);
    return {
      reservations: reservations.map((r) => ({
        id: r.id,
        venueId: r.venueId,
        guestId: r.guestId ?? null,
        guestName: r.guestName,
        partySize: r.partySize,
        reservationTime: r.reservationTime.getTime(),
        status: r.status,
        source: r.source,
        tags: r.tags,
        notes: r.notes ?? null,
        specialRequests: r.specialRequests ?? null,
        phone: r.guestPhone ?? null,
        email: r.guestEmail ?? null,
        createdAt: r.createdAt.getTime(),
        updatedAt: r.updatedAt.getTime(),
      })),
      totalCount,
    };
  }

  @RequireSubscription('active')
  @Post()
  async saveReservation(@VenueScope() scope: Scope, @Body() body: SaveReservationDto) {
    this.requireManager(scope);
    const guestName = body.guestName.trim();
    if (!guestName) throw new BadRequestException('Guest name is required');
    if (!body.reservationTime) throw new BadRequestException('Reservation time is required');
    const reservationTime = new Date(body.reservationTime);
    if (isNaN(reservationTime.getTime())) throw new BadRequestException('Invalid reservation time');

    const data = {
      venueId: scope.venueId,
      guestName,
      partySize: body.partySize,
      reservationTime,
      status: (body.status ?? 'confirmed') as any,
      source: (body.source ?? 'direct') as any,
      tags: body.tags ?? [],
      notes: body.notes?.trim() ?? null,
      specialRequests: body.specialRequests?.trim() ?? null,
      guestPhone: body.phone?.trim() ?? null,
      guestEmail: body.email?.trim() ?? null,
      durationMinutes: 90,
    };

    if (body.reservationId) {
      const existing = await this.prisma.reservation.findFirst({
        where: { id: body.reservationId, venueId: scope.venueId },
      });
      if (!existing) throw new BadRequestException('Reservation not found');
      const updated = await this.prisma.reservation.update({
        where: { id: existing.id },
        data,
      });
      return { id: updated.id };
    }

    const created = await this.prisma.reservation.create({ data });
    return { id: created.id };
  }

  @RequireSubscription('active')
  @Delete(':id')
  async removeReservation(@VenueScope() scope: Scope, @Param('id') id: string) {
    this.requireManager(scope);
    const reservation = await this.prisma.reservation.findFirst({
      where: { id, venueId: scope.venueId },
    });
    if (!reservation) throw new BadRequestException('Reservation not found');
    await this.prisma.reservation.update({
      where: { id: reservation.id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  @RequireSubscription('active')
  @Get('export-csv')
  async exportReservationsCsv(
    @VenueScope() scope: Scope,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    this.requireManager(scope);
    const where: Record<string, unknown> = {
      venueId: scope.venueId,
      deletedAt: null,
    };
    if (startDate || endDate) {
      const timeFilter: Record<string, Date> = {};
      if (startDate) timeFilter['gte'] = new Date(`${startDate}T00:00:00.000Z`);
      if (endDate) timeFilter['lte'] = new Date(`${endDate}T23:59:59.999Z`);
      where['reservationTime'] = timeFilter;
    }
    const reservations = await this.prisma.reservation.findMany({
      where: where as any,
      orderBy: { reservationTime: 'asc' },
    });
    const headers = ['Name', 'Party', 'Time', 'Status', 'Phone', 'Email', 'Notes'];
    const rows = [headers.map(csvCell).join(',')];
    for (const r of reservations) {
      rows.push([
        csvCell(r.guestName),
        csvCell(r.partySize),
        csvCell(r.reservationTime.toISOString()),
        csvCell(r.status),
        csvCell(r.guestPhone),
        csvCell(r.guestEmail),
        csvCell(r.notes),
      ].join(','));
    }
    return rows.join('\n');
  }
}
