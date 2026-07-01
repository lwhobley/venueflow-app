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
import { randomUUID } from 'crypto';
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
const TABLE_STATUSES = ['available', 'seated', 'dirty', 'reserved', 'held', 'out_of_service'] as const;
const HOLD_TYPES = ['reserved', 'held', 'seated'] as const;

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

  @IsString()
  @IsOptional()
  section?: string;

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

class AssignWaitlistDto {
  @IsString()
  waitlistId!: string;

  @IsArray()
  @IsString({ each: true })
  tableIds!: string[];

  @IsString()
  @IsIn(HOLD_TYPES)
  @IsOptional()
  holdType?: string;

  @IsNumber()
  @IsOptional()
  startsAt?: number;

  @IsNumber()
  @IsOptional()
  endsAt?: number;
}

class MergeTablesDto {
  @IsArray()
  @IsString({ each: true })
  tableIds!: string[];

  @IsInt()
  @Min(1)
  @IsOptional()
  partySize?: number;
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
    const tableIds = plan.tables.map((t) => t.id);
    const now = new Date();
    const assignments = tableIds.length
      ? await this.prisma.tableAssignment.findMany({
          where: {
            venueId: scope.venueId,
            tableId: { in: tableIds },
            releasedAt: null,
            endsAt: { gt: now },
          },
          include: {
            reservation: {
              select: {
                id: true,
                guestName: true,
                partySize: true,
                source: true,
                tags: true,
                specialRequests: true,
                status: true,
              },
            },
          },
          orderBy: { startsAt: 'asc' },
        })
      : [];
    const waitlistIds = assignments.map((a) => a.waitlistId).filter((id): id is string => Boolean(id));
    const waitlistRows = waitlistIds.length
      ? await this.prisma.waitlist.findMany({
          where: { venueId: scope.venueId, id: { in: waitlistIds } },
          select: { id: true, guestName: true, partySize: true, source: true, notes: true, status: true },
        })
      : [];
    const waitlistById = new Map(waitlistRows.map((row) => [row.id, row]));
    const assignmentsByTableId = new Map<string, typeof assignments>();
    for (const assignment of assignments) {
      const rows = assignmentsByTableId.get(assignment.tableId) ?? [];
      rows.push(assignment);
      assignmentsByTableId.set(assignment.tableId, rows);
    }

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
                mergeGroupId: state.mergeGroupId ?? null,
              }
            : null,
          activeAssignments: (assignmentsByTableId.get(table.id) ?? [])
            .filter((assignment) => assignment.startsAt <= now && assignment.endsAt > now)
            .map((assignment) => this.mapAssignment(assignment, waitlistById)),
          nextAssignment: (assignmentsByTableId.get(table.id) ?? [])
            .filter((assignment) => assignment.startsAt > now)
            .map((assignment) => this.mapAssignment(assignment, waitlistById))[0] ?? null,
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
    if (!scope) return this.emptyStats();
    const plan = await this.prisma.floorPlan.findFirst({
      where: { venueId: scope.venueId, isActive: true },
      include: { tables: { select: { id: true } } },
    });
    if (!plan) return this.emptyStats();

    const tableIds = plan.tables.map((t) => t.id);
    const [states, waitlistSize] = await Promise.all([
      this.prisma.tableState.findMany({
        where: { venueId: scope.venueId, tableId: { in: tableIds } },
      }),
      this.prisma.waitlist.count({ where: { venueId: scope.venueId, status: 'waiting' } }),
    ]);
    const occupiedStates = states.filter((s) => s.status === 'seated');
    const occupiedTables = occupiedStates.length;
    const availableTables = states.filter((s) => s.status === 'available').length;
    const dirtyCleaning = states.filter((s) => s.status === 'dirty').length;
    const seatedDurations = occupiedStates
      .map((s) => (s.seatedAt ? Math.max(0, Math.round((Date.now() - s.seatedAt.getTime()) / 60_000)) : 0))
      .filter((minutes) => minutes > 0);
    const avgTurnTimeMinutes = seatedDurations.length
      ? Math.round(seatedDurations.reduce((sum, minutes) => sum + minutes, 0) / seatedDurations.length)
      : 0;
    const longestSeatedDurationMinutes = seatedDurations.length ? Math.max(...seatedDurations) : 0;

    return {
      totalTables: tableIds.length,
      occupiedTables,
      availableTables,
      dirtyCleaning,
      occupiedCount: occupiedTables,
      availableCount: availableTables,
      dirtyCount: dirtyCleaning,
      waitlistSize,
      avgTurnTimeMinutes,
      longestSeatedDurationMinutes,
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

      // Batch-create tables, states, and chairs to avoid N+1 round-trips that
      // hold the transaction lock. A 30-table floor plan drops from 60+ sequential
      // queries to 4 batched ones.
      if (body.tables.length > 0) {
        await tx.floorTable.createMany({
          data: body.tables.map((table) => ({
            floorPlanId: plan.id,
            label: table.label,
            shape: (table.shape as TableShape) ?? 'square',
            seats: table.capacity,
            x: table.x,
            y: table.y,
            width: table.width,
            height: table.height,
            rotation: 0,
            section: (table.section as TableSection) ?? 'main',
            minSpend: 0,
            isReservable: true,
          })),
        });

        const createdTables = await tx.floorTable.findMany({
          where: { floorPlanId: plan.id },
          select: { id: true },
        });

        await tx.tableState.createMany({
          data: createdTables.map((t) => ({
            venueId,
            tableId: t.id,
            status: 'available' as const,
            lastActivityAt: new Date(),
          })),
        });

        // Collect all chairs across all tables for a single batch insert.
        const allChairs = body.tables.flatMap(
          (table) =>
            (table.chairs ?? []).map((chair) => ({
              venueId,
              floorPlanId: plan.id,
              x: chair.x,
              y: chair.y,
              rotation: chair.rotation,
              label: chair.label ?? null,
            })),
        );
        if (allChairs.length > 0) {
          await tx.floorChair.createMany({ data: allChairs });
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
  @Post('tables/merge')
  async mergeTablesForParty(@VenueScope() scope: Scope, @Body() body: MergeTablesDto) {
    requireManager(scope);
    const tableIds = Array.from(new Set(body.tableIds));
    if (tableIds.length < 2) throw new BadRequestException('Select at least two tables to merge');

    const validTableIds = await this.getActivePlanTableIds(scope.venueId);
    const unknown = tableIds.filter((id) => !validTableIds.has(id));
    if (unknown.length) throw new BadRequestException('One or more tables are not on this venue\'s floor plan');

    const states = await this.prisma.tableState.findMany({
      where: { venueId: scope.venueId, tableId: { in: tableIds } },
    });
    if (states.length !== tableIds.length) throw new BadRequestException('One or more tables are missing live state');
    const blocked = states.find((state) => state.status !== 'available' && state.status !== 'dirty');
    if (blocked) throw new ConflictException(`Table ${blocked.tableId} is not available to merge`);

    const mergeGroupId = randomUUID();
    await this.prisma.tableState.updateMany({
      where: { venueId: scope.venueId, tableId: { in: tableIds } },
      data: {
        mergeGroupId,
        partySize: body.partySize ?? null,
        lastActivityAt: new Date(),
      },
    });
    return { ok: true, mergeGroupId };
  }

  @RequireSubscription('active')
  @Post('tables/merge-groups/:id/split')
  async splitMergedTables(@VenueScope() scope: Scope, @Param('id') mergeGroupId: string) {
    requireManager(scope);
    const result = await this.prisma.tableState.updateMany({
      where: { venueId: scope.venueId, mergeGroupId },
      data: { mergeGroupId: null, partySize: null, lastActivityAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException('Merged table group not found');
    return { ok: true, splitTables: result.count };
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
  @Post('assign-waitlist')
  async assignWaitlistToTables(@VenueScope() scope: Scope, @Body() body: AssignWaitlistDto) {
    requireManager(scope);
    if (!body.tableIds.length) throw new BadRequestException('No tables specified');

    const waitlist = await this.prisma.waitlist.findFirst({
      where: { id: body.waitlistId, venueId: scope.venueId, status: { in: ['waiting', 'assigned'] } },
    });
    if (!waitlist) throw new NotFoundException('Waitlist entry not found');

    const validTableIds = await this.getActivePlanTableIds(scope.venueId);
    const unknown = body.tableIds.filter((id) => !validTableIds.has(id));
    if (unknown.length) throw new BadRequestException('One or more tables are not on this venue\'s floor plan');

    const startsAt = body.startsAt ? new Date(body.startsAt) : new Date();
    const endsAt = body.endsAt ? new Date(body.endsAt) : new Date(startsAt.getTime() + 120 * 60 * 1000);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
      throw new BadRequestException('Invalid seating window');
    }

    await withSerializableRetry(this.prisma, async (tx) => {
      const conflict = await tx.tableAssignment.findFirst({
        where: {
          venueId: scope.venueId,
          tableId: { in: body.tableIds },
          releasedAt: null,
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
          NOT: { waitlistId: body.waitlistId },
        },
        select: { tableId: true },
      });
      if (conflict) {
        throw new ConflictException(`Table ${conflict.tableId} is already booked for this time window`);
      }
      await tx.tableAssignment.updateMany({
        where: { venueId: scope.venueId, waitlistId: body.waitlistId, releasedAt: null },
        data: { releasedAt: new Date(), releasedReason: 'reassigned' },
      });
      for (const tableId of body.tableIds) {
        await tx.tableAssignment.create({
          data: {
            venueId: scope.venueId,
            waitlistId: body.waitlistId,
            tableId,
            holdType: (body.holdType ?? 'seated') as any,
            startsAt,
            endsAt,
          },
        });
      }
      await tx.waitlist.update({
        where: { id: waitlist.id },
        data: { status: body.holdType === 'held' ? 'assigned' : 'seated', readyAt: new Date() },
      });
      await tx.tableState.updateMany({
        where: { venueId: scope.venueId, tableId: { in: body.tableIds } },
        data: {
          status: body.holdType === 'held' ? 'held' : 'seated',
          partySize: waitlist.partySize,
          seatedAt: startsAt,
          lastActivityAt: new Date(),
        },
      });
    });
    return { ok: true };
  }

  @RequireSubscription('active')
  @Delete('assignments/:id')
  async releaseAssignment(@VenueScope() scope: Scope, @Param('id') id: string) {
    requireManager(scope);
    const assignment = await this.prisma.tableAssignment.findFirst({
      where: { venueId: scope.venueId, id, releasedAt: null },
      select: { id: true, tableId: true },
    });
    const tableIds = assignment ? [assignment.tableId] : [id];
    const released = assignment
      ? await this.prisma.tableAssignment.updateMany({
          where: { venueId: scope.venueId, id: assignment.id, releasedAt: null },
          data: { releasedAt: new Date(), releasedReason: 'manual' },
        })
      : await this.prisma.tableAssignment.updateMany({
          where: { venueId: scope.venueId, tableId: id, releasedAt: null },
          data: { releasedAt: new Date(), releasedReason: 'manual' },
        });
    if (released.count === 0) throw new NotFoundException('Assignment not found');
    await this.prisma.tableState.updateMany({
      where: { venueId: scope.venueId, tableId: { in: tableIds } },
      data: { status: 'available', partySize: null, seatedAt: null, lastActivityAt: new Date() },
    });
    // Find seats freed up by the released table so we can match a waitlist
    // entry whose party fits. Best-effort; fire-and-forget so the manager
    // action returns immediately.
    const table = await this.prisma.floorTable.findFirst({ where: { id: tableIds[0], floorPlan: { venueId: scope.venueId } }, select: { seats: true } });
    if (table && table.seats > 0) {
      void this.notifier.notifyNextWaitlist(scope.venueId, table.seats);
    }
    return { ok: true };
  }

  private emptyStats() {
    return {
      totalTables: 0,
      occupiedTables: 0,
      availableTables: 0,
      dirtyCleaning: 0,
      occupiedCount: 0,
      availableCount: 0,
      dirtyCount: 0,
      waitlistSize: 0,
      avgTurnTimeMinutes: 0,
      longestSeatedDurationMinutes: 0,
    };
  }

  private async getActivePlanTableIds(venueId: string) {
    const plan = await this.prisma.floorPlan.findFirst({
      where: { venueId, isActive: true },
      include: { tables: { select: { id: true } } },
    });
    return new Set((plan?.tables ?? []).map((table) => table.id));
  }

  private mapAssignment(
    assignment: {
      id: string;
      waitlistId: string | null;
      reservationId: string | null;
      holdType: string;
      startsAt: Date;
      endsAt: Date;
      reservation?: {
        guestName: string;
        partySize: number;
        source: string;
        tags: string[];
        specialRequests: string | null;
        status: string;
      } | null;
    },
    waitlistById: Map<string, { guestName: string; partySize: number; source: string; notes: string | null; status: string }>,
  ) {
    const waitlist = assignment.waitlistId ? waitlistById.get(assignment.waitlistId) : null;
    const reservation = assignment.reservation ?? null;
    return {
      assignmentId: assignment.id,
      holdType: assignment.holdType,
      sourceType: assignment.reservationId ? 'reservation' : 'waitlist',
      guestName: reservation?.guestName ?? waitlist?.guestName ?? 'Guest',
      partySize: reservation?.partySize ?? waitlist?.partySize ?? 0,
      source: reservation?.source ?? waitlist?.source ?? 'walk_in',
      tags: reservation?.tags ?? [],
      notes: reservation?.specialRequests ?? waitlist?.notes ?? null,
      status: reservation?.status ?? waitlist?.status ?? 'assigned',
      startsAt: assignment.startsAt.getTime(),
      endsAt: assignment.endsAt.getTime(),
    };
  }
}
