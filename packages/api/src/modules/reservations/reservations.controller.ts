import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Prisma, ReservationSource, ReservationStatus } from '@prisma/client';
import type { Request } from 'express';
import { isAdminRole } from '../../auth/roles';
import { Public } from '../../auth/public.decorator';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { csvCell } from '../../common/csv';
import { getClientIp } from '../../common/http';
import { assertWithinSharedRateLimit } from '../../common/rate-limit';
import { secretsMatch } from '../../common/webhook-auth';
import { PrismaService } from '../../prisma/prisma.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';

type Scope = VenueScopedRequest['venueScope'];
const RESERVATION_STATUSES = ['requested', 'confirmed', 'checked_in', 'seated', 'completed', 'no_show', 'cancelled'] as const;
const RESERVATION_SOURCES = ['direct', 'opentable', 'resy', 'phone', 'walk_in', 'sevenrooms', 'tock', 'google', 'generic'] as const;
const SYNC_SOURCES = ['opentable', 'resy', 'sevenrooms', 'tock', 'google', 'generic'] as const;
const MAX_INGEST_EVENTS = 500;
const INGEST_RATE_LIMIT_MAX = 120;
const INGEST_RATE_LIMIT_WINDOW_MS = 60_000;

class SaveReservationDto {
  @IsString()
  @IsOptional()
  reservationId?: string;

  @IsString()
  guestName!: string;

  @IsInt()
  @Min(1)
  partySize!: number;

  @IsString()
  reservationTime!: string;

  @IsIn(RESERVATION_STATUSES)
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsIn(RESERVATION_SOURCES)
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

class ReservationSyncEventDto {
  @IsString()
  externalEventId!: string;

  @IsString()
  eventType!: string;

  @IsString()
  externalId!: string;

  @IsString()
  guestName!: string;

  @IsInt()
  @Min(1)
  partySize!: number;

  @IsNumber()
  reservationTime!: number;

  @IsInt()
  @IsOptional()
  durationMinutes?: number;

  @IsIn(RESERVATION_STATUSES)
  @IsOptional()
  status?: string;

  @IsString() @IsOptional() phone?: string;
  @IsString() @IsOptional() email?: string;
  @IsString() @IsOptional() notes?: string;
  @IsString() @IsOptional() specialRequests?: string;
}

class ReservationIngestDto {
  @IsIn(SYNC_SOURCES)
  provider!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReservationSyncEventDto)
  events!: ReservationSyncEventDto[];
}

@Controller('v1/reservations')
export class ReservationsController {
  constructor(private readonly prisma: PrismaService) {}

  private requireManager(scope: Scope): asserts scope is NonNullable<Scope> {
    if (!scope || !isAdminRole(scope.role)) throw new ForbiddenException('Not authorized');
  }

  // External reservation providers (OpenTable, Resy, ...) POST sync events here,
  // authenticated by the connection's webhook secret. Each event is recorded
  // once (unique on venue+provider+externalEventId); redeliveries are skipped.
  @Public()
  @Post('ingest/:venueId')
  async ingest(
    @Req() request: Request,
    @Param('venueId') venueId: string,
    @Headers('x-webhook-secret') secret: string | undefined,
    @Body() body: ReservationIngestDto,
  ) {
    await assertWithinSharedRateLimit(this.prisma, `reservation-ingest:${venueId}:${getClientIp(request)}`, INGEST_RATE_LIMIT_MAX, INGEST_RATE_LIMIT_WINDOW_MS, 'Too many webhook requests.');
    const provider = body.provider as ReservationSource;
    const connection = await this.prisma.reservationConnection.findFirst({ where: { venueId, provider } });
    if (!connection?.webhookSecret || !secretsMatch(secret, connection.webhookSecret)) {
      throw new UnauthorizedException('Invalid webhook secret');
    }

    const events = body.events.slice(0, MAX_INGEST_EVENTS);
    const now = new Date();

    // Phase 1: Claim sync event IDs in bulk (idempotent on unique key).
    // skipDuplicates silently skips rows whose (venueId, provider, externalEventId) already exist.
    const { count: claimedCount } = await this.prisma.reservationSyncEvent.createMany({
      data: events.map((event) => ({
        venueId,
        provider,
        externalEventId: event.externalEventId,
        eventType: event.eventType,
        payload: event as unknown as Prisma.InputJsonValue,
        processedAt: now,
        status: 'processed',
      })),
      skipDuplicates: true,
    });
    const duplicates = events.length - claimedCount;

    // Identify which events are genuinely new (just claimed).
    const claimedRecords = await this.prisma.reservationSyncEvent.findMany({
      where: { venueId, provider, processedAt: now },
      select: { externalEventId: true },
    });
    const claimedIds = new Set(claimedRecords.map((r) => r.externalEventId));
    const newEvents = events.filter((e) => claimedIds.has(e.externalEventId));

    // Phase 2: Resolve existing reservations in one query.
    const externalIds = [...new Set(newEvents.map((e) => e.externalId))];
    const existingReservations = externalIds.length
      ? await this.prisma.reservation.findMany({
          where: { venueId, externalId: { in: externalIds } },
          select: { id: true, externalId: true },
        })
      : [];
    const existingByExternalId = new Map(existingReservations.map((r) => [r.externalId, r.id]));

    // Phase 3: Partition into creates and updates, execute in a transaction.
    const toCreate: Prisma.ReservationCreateManyInput[] = [];
    const toUpdate: Array<{ id: string; data: Prisma.ReservationUpdateInput; externalEventId: string }> = [];

    for (const event of newEvents) {
      const fields = {
        guestName: event.guestName,
        partySize: event.partySize,
        reservationTime: new Date(event.reservationTime),
        durationMinutes: event.durationMinutes ?? 90,
        status: (event.status ?? 'confirmed') as ReservationStatus,
        guestPhone: event.phone?.trim() ?? null,
        guestEmail: event.email?.trim() ?? null,
        notes: event.notes?.trim() ?? null,
        specialRequests: event.specialRequests?.trim() ?? null,
      };
      const existingId = existingByExternalId.get(event.externalId);
      if (existingId) {
        toUpdate.push({ id: existingId, data: fields, externalEventId: event.externalEventId });
      } else {
        toCreate.push({ venueId, source: provider, externalId: event.externalId, ...fields });
      }
    }

    const reservationIdByExternalEventId = new Map<string, string>();
    await this.prisma.$transaction(async (tx) => {
      if (toCreate.length) {
        await tx.reservation.createMany({ data: toCreate, skipDuplicates: true });
        const created = await tx.reservation.findMany({
          where: { venueId, externalId: { in: toCreate.map((c) => c.externalId as string) } },
          select: { id: true, externalId: true },
        });
        const createdById = new Map(created.map((r) => [r.externalId, r.id]));
        for (const event of newEvents) {
          const id = createdById.get(event.externalId);
          if (id && !existingByExternalId.has(event.externalId)) {
            reservationIdByExternalEventId.set(event.externalEventId, id);
          }
        }
      }
      for (const { id, data, externalEventId } of toUpdate) {
        await tx.reservation.update({ where: { id }, data });
        reservationIdByExternalEventId.set(externalEventId, id);
      }
    });

    // Back-fill reservationId on newly-processed sync events.
    await Promise.all(
      [...reservationIdByExternalEventId.entries()].map(([externalEventId, reservationId]) =>
        this.prisma.reservationSyncEvent.updateMany({
          where: { venueId, provider, externalEventId },
          data: { reservationId },
        }),
      ),
    );

    const processed = newEvents.length;
    await this.prisma.reservationConnection.update({ where: { id: connection.id }, data: { lastSyncAt: new Date() } });
    return { ok: true, processed, duplicates };
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
    const pageNum = Math.max(0, parseInt(page ?? '0', 10) || 0);
    const limitNum = Math.min(Math.max(1, parseInt(limit ?? '50', 10) || 50), 200);
    const where: Record<string, unknown> = {
      venueId: scope.venueId,
      deletedAt: null,
    };
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('Invalid date');
      const start = new Date(`${date}T00:00:00.000Z`);
      const end = new Date(`${date}T23:59:59.999Z`);
      where['reservationTime'] = { gte: start, lte: end };
    }
    if (status) {
      if (!RESERVATION_STATUSES.includes(status as any)) throw new BadRequestException('Invalid status');
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
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="reservations.csv"')
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
      if (startDate) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new BadRequestException('Invalid start date');
        timeFilter['gte'] = new Date(`${startDate}T00:00:00.000Z`);
      }
      if (endDate) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new BadRequestException('Invalid end date');
        timeFilter['lte'] = new Date(`${endDate}T23:59:59.999Z`);
      }
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
