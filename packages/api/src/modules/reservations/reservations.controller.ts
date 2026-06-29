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
import { ReservationMutationService } from './reservation-mutation.service';
import { ReservationNotifierService } from './reservation-notifier.service';

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

class ReservationHoldDto {
  @IsString()
  startsAt!: string;

  @IsString()
  endsAt!: string;

  @IsString()
  reason!: string;
}

@Controller('v1/reservations')
export class ReservationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: ReservationNotifierService,
    private readonly mutations: ReservationMutationService,
  ) {}

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
      // NOTE: Date boundaries use UTC. For venues not in UTC this means the
      // window may not align with local midnight. Until the Venue model stores
      // a timezone, callers should be aware of this offset.
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
    const { reservation, previousStatus } = await this.mutations.saveReservation({
      venueId: scope.venueId,
      reservationId: body.reservationId,
      guestName: body.guestName,
      partySize: body.partySize,
      reservationTime: body.reservationTime,
      status: body.status,
      notes: body.notes,
      source: body.source,
      tags: body.tags,
      specialRequests: body.specialRequests,
      tableNumbers: body.tableNumbers,
      phone: body.phone,
      email: body.email,
    });
    if (
      reservation.guestEmail &&
      reservation.status === 'confirmed' &&
      (!body.reservationId || previousStatus !== 'confirmed') &&
      !reservation.confirmationSentAt
    ) {
      void this.notifier.sendConfirmation(reservation.id);
    }
    return { id: reservation.id };
  }

  // ============================================================
  // Cover-pacing: 15-min buckets of booked covers for a given date.
  // ============================================================
  @RequireSubscription('active')
  @Get('cover-pacing')
  async getCoverPacing(@VenueScope() scope: Scope, @Query('date') date?: string) {
    this.requireManager(scope);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Pass ?date=YYYY-MM-DD');
    }
    // NOTE: Date boundaries use UTC — see getReservationsPage comment for
    // the timezone caveat. Will be venue-local once Venue stores a tz.
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(`${date}T23:59:59.999Z`);

    const [reservations, plan] = await Promise.all([
      this.prisma.reservation.findMany({
        where: {
          venueId: scope.venueId,
          deletedAt: null,
          status: { notIn: ['cancelled', 'no_show'] },
          reservationTime: { gte: start, lte: end },
        },
        select: { reservationTime: true, partySize: true, durationMinutes: true },
      }),
      this.prisma.floorPlan.findFirst({
        where: { venueId: scope.venueId, isActive: true },
        include: { tables: { select: { seats: true, isReservable: true } } },
      }),
    ]);

    const seatingCapacity = (plan?.tables ?? [])
      .filter((t) => t.isReservable)
      .reduce((sum, t) => sum + t.seats, 0);

    // 96 buckets of 15 minutes covering the venue's day.
    const buckets: Array<{ slot: number; startsAt: number; covers: number }> = [];
    for (let i = 0; i < 96; i += 1) {
      buckets.push({ slot: i, startsAt: start.getTime() + i * 15 * 60 * 1000, covers: 0 });
    }
    for (const r of reservations) {
      // Count a reservation in every 15-min slot it overlaps so a 7pm party
      // of 6 with a 90-min turn shows up in 6 buckets, accurately reflecting
      // kitchen load.
      const startMs = r.reservationTime.getTime();
      const endMs = startMs + r.durationMinutes * 60 * 1000;
      const firstSlot = Math.max(0, Math.floor((startMs - start.getTime()) / (15 * 60 * 1000)));
      const lastSlot = Math.min(95, Math.floor((endMs - 1 - start.getTime()) / (15 * 60 * 1000)));
      for (let i = firstSlot; i <= lastSlot; i += 1) {
        buckets[i].covers += r.partySize;
      }
    }

    const peak = buckets.reduce((max, b) => Math.max(max, b.covers), 0);
    return {
      date,
      seatingCapacity,
      peakCovers: peak,
      totalReservations: reservations.length,
      buckets: buckets.filter((b) => b.covers > 0 || (b.slot >= 40 && b.slot <= 92)).map((b) => ({
        startsAt: b.startsAt,
        covers: b.covers,
      })),
    };
  }

  // ============================================================
  // Guest preference autofill: lookup by email or phone.
  // ============================================================
  @RequireSubscription('active')
  @Get('guest-autofill')
  async guestAutofill(
    @VenueScope() scope: Scope,
    @Query('email') email?: string,
    @Query('phone') phone?: string,
  ) {
    this.requireManager(scope);
    const cleanEmail = email?.trim().toLowerCase();
    const cleanPhone = phone?.replace(/[^\d+]/g, '');
    if (!cleanEmail && !cleanPhone) return { guest: null };
    const guest = await this.prisma.guest.findFirst({
      where: {
        venueId: scope.venueId,
        deletedAt: null,
        OR: [
          ...(cleanEmail ? [{ email: cleanEmail }] : []),
          ...(cleanPhone ? [{ phone: cleanPhone }] : []),
        ],
      },
    });
    if (!guest) return { guest: null };
    const recent = await this.prisma.reservation.findFirst({
      where: { venueId: scope.venueId, deletedAt: null, guestId: guest.id, completedAt: { not: null } },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true, partySize: true },
    });
    return {
      guest: {
        id: guest.id,
        fullName: guest.fullName,
        email: guest.email,
        phone: guest.phone,
        favoriteTable: guest.favoriteTable,
        preferredServer: guest.preferredServer,
        dietaryNotes: guest.dietaryNotes,
        tags: guest.tags,
        lifecycleStage: guest.lifecycleStage,
        lastVisitAt: recent?.completedAt?.getTime() ?? null,
        lastPartySize: recent?.partySize ?? null,
      },
    };
  }

  // ============================================================
  // Reservation holds: block off date/time windows.
  // ============================================================
  @RequireSubscription('active')
  @Get('holds')
  async listHolds(@VenueScope() scope: Scope) {
    this.requireManager(scope);
    const now = new Date();
    const rows = await this.prisma.reservationHold.findMany({
      where: { venueId: scope.venueId, endsAt: { gte: now } },
      orderBy: { startsAt: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      startsAt: row.startsAt.getTime(),
      endsAt: row.endsAt.getTime(),
      reason: row.reason,
    }));
  }

  @RequireSubscription('active')
  @Post('holds')
  async createHold(@VenueScope() scope: Scope, @Body() body: ReservationHoldDto) {
    this.requireManager(scope);
    const created = await this.mutations.createHold({
      venueId: scope.venueId,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      reason: body.reason,
    });
    return { id: created.id };
  }

  @RequireSubscription('active')
  @Delete('holds/:id')
  async deleteHold(@VenueScope() scope: Scope, @Param('id') id: string) {
    this.requireManager(scope);
    await this.mutations.deleteHold({ venueId: scope.venueId, holdId: id });
    return { ok: true };
  }

  @RequireSubscription('active')
  @Delete(':id')
  async removeReservation(@VenueScope() scope: Scope, @Param('id') id: string) {
    this.requireManager(scope);
    await this.mutations.removeReservation({ venueId: scope.venueId, reservationId: id });
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
