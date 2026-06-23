import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TableShape, TableSection } from '@prisma/client';
import { isAdminRole } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { withSerializableRetry } from '../../common/tx-retry';
import { ReservationNotifierService } from '../reservations/reservation-notifier.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';

type Scope = VenueScopedRequest['venueScope'];

const TABLE_SHAPES = ['round', 'square', 'rect', 'booth'] as const;
const TABLE_STATUSES = ['available', 'seated', 'dirty', 'reserved'] as const;

class TableChairDto {
  @IsNumber()
  x!: number;

  @IsNumber()
  y!: number;

  @IsNumber()
  rotation!: number;

  @IsString()
  @IsOptional()
  label?: string;
}

class TableDto {
  @IsString()
  @IsOptional()
  id?: string;

  @IsString()
  label!: string;

  @IsNumber()
  x!: number;

  @IsNumber()
  y!: number;

  @IsNumber()
  width!: number;

  @IsNumber()
  height!: number;

  @IsString()
  @IsIn(TABLE_SHAPES)
  shape!: string;

  @IsInt()
  @Min(1)
  capacity!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TableChairDto)
  @IsOptional()
  chairs?: TableChairDto[];
}

class SaveFloorPlanDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TableDto)
  tables!: TableDto[];
}

class AddWaitlistDto {
  @IsString()
  guestName!: string;

  @IsInt()
  @Min(1)
  partySize!: number;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

class TableStatusDto {
  @IsString()
  @IsIn(TABLE_STATUSES)
  status!: string;
}

class AssignReservationDto {
  @IsString()
  reservationId!: string;

  @IsArray()
  @IsString({ each: true })
  tableIds!: string[];
}

function requireManager(scope: Scope): asserts scope is NonNullable<Scope> {
  if (!scope || !isAdminRole(scope.role)) throw new ForbiddenException('Not authorized');
}

@Controller('v1/floor')
export class FloorController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: ReservationNotifierService,
  ) {}

  @RequireSubscription('active')
  @Get('active')
  async getActiveFloorPlan(@VenueScope() scope: Scope) {
    if (!scope) return null;
    const plan = await this.prisma.floorPlan.findFirst({
      where: { venueId: scope.venueId, isActive: true },
      include: {
        tables: true,
        chairs: true,
      },
    });
    if (!plan) return null;

    const tableStates = await this.prisma.tableState.findMany({
      where: { venueId: scope.venueId, tableId: { in: plan.tables.map((t) => t.id) } },
    });
    const stateByTableId = new Map(tableStates.map((s) => [s.tableId, s]));

    return {
      floorPlan: {
        _id: plan.id,
        id: plan.id,
        venueId: plan.venueId,
        name: plan.name,
        width: plan.width,
        height: plan.height,
        backgroundImageUrl: plan.backgroundImageUrl ?? null,
        isActive: plan.isActive,
        createdAt: plan.createdAt.getTime(),
        updatedAt: plan.updatedAt.getTime(),
      },
      tables: plan.tables.map((table) => {
        const state = stateByTableId.get(table.id) ?? null;
        return {
          table: {
            _id: table.id,
            id: table.id,
            floorPlanId: table.floorPlanId,
            label: table.label,
            shape: table.shape,
            seats: table.seats,
            x: table.x,
            y: table.y,
            width: table.width,
            height: table.height,
            rotation: table.rotation,
            section: table.section,
            minSpend: table.minSpend,
            isReservable: table.isReservable,
          },
          state: state
            ? {
                _id: state.id,
                id: state.id,
                venueId: state.venueId,
                tableId: state.tableId,
                status: state.status,
                partySize: state.partySize ?? null,
                serverId: state.serverId ?? null,
                seatedAt: state.seatedAt?.getTime() ?? null,
                lastActivityAt: state.lastActivityAt.getTime(),
                notes: state.notes ?? null,
              }
            : null,
        };
      }),
      chairs: plan.chairs.map((c) => ({
        _id: c.id,
        id: c.id,
        x: c.x,
        y: c.y,
        rotation: c.rotation,
        label: c.label ?? null,
      })),
    };
  }

  @RequireSubscription('active')
  @Get('stats')
  async getFloorStats(@VenueScope() scope: Scope) {
    if (!scope) return { totalTables: 0, occupiedTables: 0, availableTables: 0, dirtyCleaning: 0 };
    const plan = await this.prisma.floorPlan.findFirst({
      where: { venueId: scope.venueId, isActive: true },
      include: { tables: { select: { id: true } } },
    });
    if (!plan) return { totalTables: 0, occupiedTables: 0, availableTables: 0, dirtyCleaning: 0 };

    const tableIds = plan.tables.map((t) => t.id);
    const states = await this.prisma.tableState.findMany({
      where: { venueId: scope.venueId, tableId: { in: tableIds } },
    });

    return {
      totalTables: tableIds.length,
      occupiedTables: states.filter((s) => s.status === 'seated').length,
      availableTables: states.filter((s) => s.status === 'available').length,
      dirtyCleaning: states.filter((s) => s.status === 'dirty').length,
    };
  }

  @RequireSubscription('active')
  @Post()
  async saveFloorPlan(@VenueScope() scope: Scope, @Body() body: SaveFloorPlanDto) {
    requireManager(scope);
    const venueId = scope.venueId;

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.floorPlan.findFirst({ where: { venueId, isActive: true } });
      if (existing) {
        await tx.floorPlan.update({ where: { id: existing.id }, data: { isActive: false } });
      }

      const plan = await tx.floorPlan.create({
        data: {
          venueId,
          name: 'Floor Plan',
          width: 800,
          height: 600,
          isActive: true,
        },
      });

      for (const table of body.tables) {
        const created = await tx.floorTable.create({
          data: {
            floorPlanId: plan.id,
            label: table.label,
            shape: (table.shape as TableShape) ?? 'square',
            seats: table.capacity,
            x: table.x,
            y: table.y,
            width: table.width,
            height: table.height,
            rotation: 0,
            section: 'main' as TableSection,
            minSpend: 0,
            isReservable: true,
          },
        });

        await tx.tableState.create({
          data: {
            venueId,
            tableId: created.id,
            status: 'available',
            lastActivityAt: new Date(),
          },
        });

        for (const chair of table.chairs ?? []) {
          await tx.floorChair.create({
            data: {
              venueId,
              floorPlanId: plan.id,
              x: chair.x,
              y: chair.y,
              rotation: chair.rotation,
              label: chair.label ?? null,
            },
          });
        }
      }

      return plan;
    });

    return { ok: true };
  }

  @RequireSubscription('active')
  @Delete()
  async clearActiveFloorPlan(@VenueScope() scope: Scope) {
    requireManager(scope);
    const plan = await this.prisma.floorPlan.findFirst({
      where: { venueId: scope.venueId, isActive: true },
      include: { tables: { select: { id: true } }, chairs: { select: { id: true } } },
    });
    if (!plan) return { deletedTables: 0, deletedChairs: 0 };

    const tableIds = plan.tables.map((t) => t.id);
    const chairIds = plan.chairs.map((c) => c.id);

    await this.prisma.$transaction([
      this.prisma.tableState.deleteMany({ where: { tableId: { in: tableIds } } }),
      this.prisma.tableAssignment.deleteMany({ where: { tableId: { in: tableIds } } }),
      this.prisma.floorChair.deleteMany({ where: { id: { in: chairIds } } }),
      this.prisma.floorTable.deleteMany({ where: { floorPlanId: plan.id } }),
      this.prisma.floorPlan.update({ where: { id: plan.id }, data: { isActive: false } }),
    ]);

    return { deletedTables: tableIds.length, deletedChairs: chairIds.length };
  }

  @RequireSubscription('active')
  @Get('unassigned-reservations')
  async getUnassignedReservations(@VenueScope() scope: Scope, @Query('withinMinutes') withinMinutes?: string) {
    if (!scope) return [];
    const parsed = parseInt(withinMinutes ?? '', 10);
    // Clamp to a sane window; a bad/NaN value falls back to the 120-min default
    // rather than producing an Invalid Date cutoff (which silently returns []).
    const minutes = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 1440) : 120;
    const now = new Date();
    const cutoff = new Date(now.getTime() + minutes * 60 * 1000);

    const reservations = await this.prisma.reservation.findMany({
      where: {
        venueId: scope.venueId,
        reservationTime: { gte: now, lte: cutoff },
        status: { in: ['confirmed', 'requested'] },
        deletedAt: null,
      },
      orderBy: { reservationTime: 'asc' },
    });

    const assigned = await this.prisma.tableAssignment.findMany({
      where: {
        venueId: scope.venueId,
        reservationId: { in: reservations.map((r) => r.id) },
        releasedAt: null,
      },
    });
    const assignedReservationIds = new Set(assigned.map((a) => a.reservationId).filter(Boolean));

    return reservations
      .filter((r) => !assignedReservationIds.has(r.id))
      .map((r) => ({
        _id: r.id,
        id: r.id,
        guestName: r.guestName,
        partySize: r.partySize,
        reservationTime: r.reservationTime.getTime(),
        status: r.status,
      }));
  }

  @RequireSubscription('active')
  @Get('waitlist')
  async getOpenWaitlist(@VenueScope() scope: Scope) {
    if (!scope) return [];
    const rows = await this.prisma.waitlist.findMany({
      where: { venueId: scope.venueId, status: 'waiting' },
      orderBy: { requestedAt: 'asc' },
    });
    return rows.map((r) => ({
      _id: r.id,
      id: r.id,
      guestName: r.guestName,
      partySize: r.partySize,
      phone: r.guestPhone ?? null,
      notes: r.notes ?? null,
      status: r.status,
      requestedAt: r.requestedAt.getTime(),
    }));
  }

  @RequireSubscription('active')
  @Post('waitlist')
  async addToWaitlist(@VenueScope() scope: Scope, @Body() body: AddWaitlistDto) {
    if (!scope) throw new ForbiddenException('No venue profile found');
    const row = await this.prisma.waitlist.create({
      data: {
        venueId: scope.venueId,
        guestName: body.guestName.trim(),
        partySize: body.partySize,
        guestPhone: body.phone?.trim() ?? null,
        guestEmail: body.email?.trim() ?? null,
        notes: body.notes?.trim() ?? null,
        source: 'walk_in',
        status: 'waiting',
        requestedAt: new Date(),
      },
    });
    return { _id: row.id, id: row.id };
  }

  @RequireSubscription('active')
  @Delete('waitlist/:id')
  async removeFromWaitlist(@VenueScope() scope: Scope, @Param('id') id: string) {
    if (!scope) throw new ForbiddenException('No venue profile found');
    const row = await this.prisma.waitlist.findFirst({ where: { id, venueId: scope.venueId } });
    if (!row) throw new NotFoundException('Waitlist entry not found');
    await this.prisma.waitlist.update({ where: { id: row.id }, data: { status: 'removed' } });
    return { ok: true };
  }

  @RequireSubscription('active')
  @Patch('waitlist/:id/ready')
  async markWaitlistReady(@VenueScope() scope: Scope, @Param('id') id: string) {
    if (!scope) throw new ForbiddenException('No venue profile found');
    const row = await this.prisma.waitlist.findFirst({ where: { id, venueId: scope.venueId } });
    if (!row) throw new NotFoundException('Waitlist entry not found');
    await this.prisma.waitlist.update({ where: { id: row.id }, data: { status: 'assigned', readyAt: new Date() } });
    return { ok: true };
  }

  @RequireSubscription('active')
  @Patch('tables/:id/status')
  async updateTableStatus(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: TableStatusDto) {
    if (!scope) throw new ForbiddenException('No venue profile found');
    const state = await this.prisma.tableState.findFirst({ where: { tableId: id, venueId: scope.venueId } });
    if (!state) throw new NotFoundException('Table not found');
    await this.prisma.tableState.update({
      where: { id: state.id },
      data: { status: body.status as any, lastActivityAt: new Date() },
    });
    return { ok: true };
  }

  @RequireSubscription('active')
  @Post('assign-reservation')
  async assignReservationToTables(@VenueScope() scope: Scope, @Body() body: AssignReservationDto) {
    requireManager(scope);
    if (!body.tableIds.length) throw new BadRequestException('No tables specified');

    const reservation = await this.prisma.reservation.findFirst({
      where: { id: body.reservationId, venueId: scope.venueId },
    });
    if (!reservation) throw new NotFoundException('Reservation not found');

    // Validate every table belongs to this venue's active floor plan so a
    // caller can't attach a reservation to another venue's (or a stale) table.
    const plan = await this.prisma.floorPlan.findFirst({
      where: { venueId: scope.venueId, isActive: true },
      include: { tables: { select: { id: true } } },
    });
    const validTableIds = new Set((plan?.tables ?? []).map((t) => t.id));
    const unknown = body.tableIds.filter((id) => !validTableIds.has(id));
    if (unknown.length) throw new BadRequestException('One or more tables are not on this venue\'s floor plan');

    const endsAt = new Date(reservation.reservationTime.getTime() + reservation.durationMinutes * 60 * 1000);
    // Release prior assignments for THIS reservation, then check each requested
    // table for active overlaps from OTHER reservations, then create the new
    // holds — all inside a Serializable transaction so two managers can't
    // simultaneously assign overlapping holds to the same table.
    await withSerializableRetry(this.prisma, async (tx) => {
      await tx.tableAssignment.updateMany({
        where: { venueId: scope.venueId, reservationId: body.reservationId, releasedAt: null },
        data: { releasedAt: new Date(), releasedReason: 'reassigned' },
      });
      const conflict = await tx.tableAssignment.findFirst({
        where: {
          venueId: scope.venueId,
          tableId: { in: body.tableIds },
          releasedAt: null,
          startsAt: { lt: endsAt },
          endsAt: { gt: reservation.reservationTime },
          NOT: { reservationId: body.reservationId },
        },
        select: { tableId: true },
      });
      if (conflict) {
        throw new ConflictException(`Table ${conflict.tableId} is already booked for this time window`);
      }
      for (const tableId of body.tableIds) {
        await tx.tableAssignment.create({
          data: {
            venueId: scope.venueId,
            reservationId: body.reservationId,
            tableId,
            holdType: 'reserved',
            startsAt: reservation.reservationTime,
            endsAt,
          },
        });
      }
    });
    return { ok: true };
  }

  @RequireSubscription('active')
  @Delete('assignments/:tableId')
  async releaseAssignment(@VenueScope() scope: Scope, @Param('tableId') tableId: string) {
    requireManager(scope);
    await this.prisma.tableAssignment.updateMany({
      where: { venueId: scope.venueId, tableId, releasedAt: null },
      data: { releasedAt: new Date(), releasedReason: 'manual' },
    });
    // Find seats freed up by the released table so we can match a waitlist
    // entry whose party fits. Best-effort; fire-and-forget so the manager
    // action returns immediately.
    const table = await this.prisma.floorTable.findUnique({ where: { id: tableId }, select: { seats: true } });
    if (table && table.seats > 0) {
      void this.notifier.notifyNextWaitlist(scope.venueId, table.seats);
    }
    return { ok: true };
  }
}
