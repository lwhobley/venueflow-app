import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ShiftStatus } from '@prisma/client';
import { isAdminRole } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import {
  dayLabel,
  mapAvailability,
  mapBlackout,
  mapScheduleShift,
  minutesToTime,
  shiftConflictsWithAvailability,
} from '../../common/mappers';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.guard';

type Scope = VenueScopedRequest['venueScope'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

class UpsertShiftDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayIndex!: number;

  @IsInt()
  @Min(0)
  @Max(1440)
  startMinutes!: number;

  @IsInt()
  @Min(0)
  @Max(1440)
  endMinutes!: number;

  @IsString()
  jobTitle!: string;

  @IsString()
  station!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  profileId?: string;
}

class AssignShiftDto {
  @IsString()
  profileId!: string;
}

class AvailabilityBlockDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayIndex!: number;

  @IsInt()
  @Min(0)
  @Max(1440)
  startMinutes!: number;

  @IsInt()
  @Min(0)
  @Max(1440)
  endMinutes!: number;

  @IsBoolean()
  available!: boolean;
}

class UpsertAvailabilityDto {
  @ValidateNested({ each: true })
  @Type(() => AvailabilityBlockDto)
  rows!: AvailabilityBlockDto[];
}

class UpsertBlackoutDto {
  @IsString()
  startDate!: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsString()
  reason!: string;
}

type ShiftRow = {
  id: string;
  venueId: string;
  profileId: string | null;
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
  jobTitle: string;
  station: string;
  notes: string | null;
  status: ShiftStatus;
};

@Controller('v1/scheduling')
export class SchedulingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- Shifts ----------

  @RequireSubscription()
  @Get('shifts')
  async listShifts(@VenueScope() scope: Scope) {
    if (!scope) return [];
    const [shifts, staff] = await Promise.all([
      this.prisma.scheduleShift.findMany({
        where: { venueId: scope.venueId },
        orderBy: [{ dayIndex: 'asc' }, { startMinutes: 'asc' }],
      }),
      this.prisma.profile.findMany({ where: { venueId: scope.venueId } }),
    ]);
    const avail = await this.prisma.availability.findMany({
      where: { venueId: scope.venueId },
    });
    const nameById = new Map(staff.map((s) => [s.id, s.fullName]));
    const availByProfile = new Map<string, typeof avail>();
    for (const a of avail) {
      const list = availByProfile.get(a.profileId) ?? [];
      list.push(a);
      availByProfile.set(a.profileId, list);
    }
    return shifts.map((shift) => {
      const memberName = shift.profileId ? nameById.get(shift.profileId) ?? null : null;
      const conflict = shift.profileId
        ? shiftConflictsWithAvailability(
            availByProfile.get(shift.profileId) ?? [],
            shift.dayIndex,
            shift.startMinutes,
            shift.endMinutes,
          )
        : false;
      return mapScheduleShift(shift, memberName, conflict);
    });
  }

  @RequireSubscription()
  @Get('shifts/mine')
  async listMyShifts(@VenueScope() scope: Scope) {
    if (!scope) return { mine: [], open: [] };
    const [shifts, myAvail] = await Promise.all([
      this.prisma.scheduleShift.findMany({
        where: { venueId: scope.venueId },
        orderBy: [{ dayIndex: 'asc' }, { startMinutes: 'asc' }],
      }),
      this.prisma.availability.findMany({ where: { profileId: scope.profileId } }),
    ]);
    const toValue = (shift: ShiftRow) =>
      mapScheduleShift(
        shift,
        null,
        shiftConflictsWithAvailability(
          myAvail,
          shift.dayIndex,
          shift.startMinutes,
          shift.endMinutes,
        ),
      );
    return {
      mine: shifts.filter((s) => s.profileId === scope.profileId).map(toValue),
      open: shifts.filter((s) => s.status === 'open' && !s.profileId).map(toValue),
    };
  }

  @RequireSubscription()
  @Post('shifts')
  async createShift(@VenueScope() scope: Scope, @Body() body: UpsertShiftDto) {
    if (!scope || !isAdminRole(scope.role)) throw new ForbiddenException('Not authorized');
    if (body.endMinutes <= body.startMinutes) {
      throw new BadRequestException('End time must be after start time');
    }
    if (body.profileId) {
      await this.assertMemberInVenue(scope.venueId, body.profileId);
      await this.assertNoDoubleBook(
        scope.venueId,
        body.profileId,
        body.dayIndex,
        body.startMinutes,
        body.endMinutes,
      );
    }
    const shift = await this.prisma.scheduleShift.create({
      data: {
        venueId: scope.venueId,
        profileId: body.profileId ?? null,
        dayIndex: body.dayIndex,
        startMinutes: body.startMinutes,
        endMinutes: body.endMinutes,
        jobTitle: body.jobTitle.trim() || 'Staff',
        station: body.station.trim() || 'Floor',
        notes: body.notes?.trim() || null,
        status: body.profileId ? 'scheduled' : 'open',
      },
    });
    await this.markScheduleEdited(scope.venueId);
    if (body.profileId) {
      await this.notifications.notifyProfile({
        venueId: scope.venueId,
        profileId: body.profileId,
        kind: 'shift_assigned',
        title: 'New shift assigned',
        body: `${dayLabel(body.dayIndex)} ${minutesToTime(body.startMinutes)}-${minutesToTime(body.endMinutes)} · ${body.jobTitle}`,
      });
    } else {
      await this.notifications.notifyManagers({
        venueId: scope.venueId,
        kind: 'shift_assigned',
        title: 'Open shift added',
        body: `${dayLabel(body.dayIndex)} ${minutesToTime(body.startMinutes)}-${minutesToTime(body.endMinutes)} needs coverage.`,
      });
    }
    return mapScheduleShift(shift);
  }

  @RequireSubscription()
  @Put('shifts/:id')
  async upsertShift(
    @VenueScope() scope: Scope,
    @Param('id') id: string,
    @Body() body: UpsertShiftDto,
  ) {
    if (!scope || !isAdminRole(scope.role)) throw new ForbiddenException('Not authorized');
    if (body.endMinutes <= body.startMinutes) {
      throw new BadRequestException('End time must be after start time');
    }
    const existing = await this.prisma.scheduleShift.findUnique({ where: { id } });
    if (!existing || existing.venueId !== scope.venueId) {
      throw new NotFoundException('Shift not found');
    }
    const updated = await this.prisma.scheduleShift.update({
      where: { id: existing.id },
      data: {
        dayIndex: body.dayIndex,
        startMinutes: body.startMinutes,
        endMinutes: body.endMinutes,
        jobTitle: body.jobTitle.trim() || 'Staff',
        station: body.station.trim() || 'Floor',
        notes: body.notes?.trim() || null,
      },
    });
    await this.markScheduleEdited(scope.venueId);
    return mapScheduleShift(updated);
  }

  @RequireSubscription()
  @Delete('shifts/:id')
  async deleteShift(@VenueScope() scope: Scope, @Param('id') id: string) {
    if (!scope || !isAdminRole(scope.role)) throw new ForbiddenException('Not authorized');
    const existing = await this.prisma.scheduleShift.findUnique({ where: { id } });
    if (!existing || existing.venueId !== scope.venueId) {
      throw new NotFoundException('Shift not found');
    }
    await this.prisma.scheduleShift.delete({ where: { id: existing.id } });
    await this.markScheduleEdited(scope.venueId);
    return { ok: true };
  }

  @RequireSubscription()
  @Post('shifts/:id/assign')
  async assignShift(
    @VenueScope() scope: Scope,
    @Param('id') id: string,
    @Body() body: AssignShiftDto,
  ) {
    if (!scope || !isAdminRole(scope.role)) throw new ForbiddenException('Not authorized');
    const shift = await this.prisma.scheduleShift.findUnique({ where: { id } });
    if (!shift || shift.venueId !== scope.venueId) {
      throw new NotFoundException('Shift not found');
    }
    await this.assertMemberInVenue(scope.venueId, body.profileId);
    await this.assertNoDoubleBook(
      scope.venueId,
      body.profileId,
      shift.dayIndex,
      shift.startMinutes,
      shift.endMinutes,
      shift.id,
    );
    const updated = await this.prisma.scheduleShift.update({
      where: { id: shift.id },
      data: { profileId: body.profileId, status: 'scheduled' },
    });
    await this.markScheduleEdited(scope.venueId);
    await this.notifications.notifyProfile({
      venueId: scope.venueId,
      profileId: body.profileId,
      kind: 'shift_assigned',
      title: 'Shift assigned',
      body: `${dayLabel(shift.dayIndex)} ${minutesToTime(shift.startMinutes)}-${minutesToTime(shift.endMinutes)} · ${shift.jobTitle}`,
    });
    return mapScheduleShift(updated);
  }

  @RequireSubscription()
  @Post('shifts/:id/claim')
  async claimOpenShift(@VenueScope() scope: Scope, @Param('id') id: string) {
    if (!scope) throw new ForbiddenException('Profile is not initialized');
    const shift = await this.prisma.scheduleShift.findUnique({ where: { id } });
    if (!shift || shift.venueId !== scope.venueId) {
      throw new NotFoundException('Shift not found');
    }
    if (shift.profileId || shift.status !== 'open') {
      throw new BadRequestException('This shift is no longer open');
    }
    await this.assertNoDoubleBook(
      scope.venueId,
      scope.profileId,
      shift.dayIndex,
      shift.startMinutes,
      shift.endMinutes,
      shift.id,
    );
    const updated = await this.prisma.scheduleShift.update({
      where: { id: shift.id },
      data: { profileId: scope.profileId, status: 'covered' },
    });
    await this.markScheduleEdited(scope.venueId);
    const profile = await this.prisma.profile.findUniqueOrThrow({
      where: { id: scope.profileId },
    });
    await this.notifications.notifyManagers({
      venueId: scope.venueId,
      kind: 'shift_assigned',
      title: 'Open shift covered',
      body: `${profile.fullName} picked up ${dayLabel(shift.dayIndex)} ${minutesToTime(shift.startMinutes)}-${minutesToTime(shift.endMinutes)}.`,
    });
    return mapScheduleShift(updated);
  }

  // ---------- Availability ----------

  @RequireSubscription()
  @Get('availability')
  async listAvailability(@VenueScope() scope: Scope) {
    if (!scope) return [];
    // Admins see whole venue, employees see their own.
    const rows = await this.prisma.availability.findMany({
      where: isAdminRole(scope.role)
        ? { venueId: scope.venueId }
        : { profileId: scope.profileId },
      orderBy: [{ dayIndex: 'asc' }, { startMinutes: 'asc' }],
    });
    return rows.map(mapAvailability);
  }

  @RequireSubscription()
  @Put('availability')
  async upsertAvailability(@VenueScope() scope: Scope, @Body() body: UpsertAvailabilityDto) {
    if (!scope) throw new ForbiddenException('Profile is not initialized');
    for (const row of body.rows) {
      if (row.endMinutes <= row.startMinutes) {
        throw new BadRequestException('End time must be after start time');
      }
    }
    await this.prisma.$transaction([
      this.prisma.availability.deleteMany({ where: { profileId: scope.profileId } }),
      ...body.rows.map((row) =>
        this.prisma.availability.create({
          data: {
            venueId: scope.venueId,
            profileId: scope.profileId,
            dayIndex: row.dayIndex,
            startMinutes: row.startMinutes,
            endMinutes: row.endMinutes,
            available: row.available,
          },
        }),
      ),
    ]);
    const rows = await this.prisma.availability.findMany({
      where: { profileId: scope.profileId },
      orderBy: [{ dayIndex: 'asc' }, { startMinutes: 'asc' }],
    });
    return rows.map(mapAvailability);
  }

  // ---------- Blackouts ----------

  @RequireSubscription()
  @Get('blackouts')
  async listBlackouts(@VenueScope() scope: Scope) {
    if (!scope) return [];
    const rows = await this.prisma.blackoutDate.findMany({
      where: { venueId: scope.venueId },
      orderBy: { startDate: 'asc' },
    });
    return rows.map(mapBlackout);
  }

  @RequireSubscription()
  @Post('blackouts')
  async upsertBlackout(@VenueScope() scope: Scope, @Body() body: UpsertBlackoutDto) {
    if (!scope || !isAdminRole(scope.role)) throw new ForbiddenException('Not authorized');
    const start = body.startDate.trim();
    const end = (body.endDate?.trim() || start);
    if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) {
      throw new BadRequestException('Dates must be in YYYY-MM-DD format');
    }
    if (end < start) {
      throw new BadRequestException('End date must be on or after the start date');
    }
    const row = await this.prisma.blackoutDate.create({
      data: {
        venueId: scope.venueId,
        startDate: start,
        endDate: end,
        reason: body.reason.trim() || 'Blackout',
        createdBy: scope.profileId,
      },
    });
    return mapBlackout(row);
  }

  @RequireSubscription()
  @Delete('blackouts/:id')
  async deleteBlackout(@VenueScope() scope: Scope, @Param('id') id: string) {
    if (!scope || !isAdminRole(scope.role)) throw new ForbiddenException('Not authorized');
    const existing = await this.prisma.blackoutDate.findUnique({ where: { id } });
    if (!existing || existing.venueId !== scope.venueId) {
      throw new NotFoundException('Blackout not found');
    }
    await this.prisma.blackoutDate.delete({ where: { id: existing.id } });
    return { ok: true };
  }

  // ---------- Helpers ----------

  private async assertMemberInVenue(venueId: string, profileId: string) {
    const member = await this.prisma.profile.findUnique({ where: { id: profileId } });
    if (!member || member.venueId !== venueId) {
      throw new BadRequestException('Staff member is not in this venue');
    }
  }

  private async assertNoDoubleBook(
    venueId: string,
    profileId: string,
    dayIndex: number,
    startMinutes: number,
    endMinutes: number,
    excludeShiftId?: string,
  ) {
    const shifts = await this.prisma.scheduleShift.findMany({
      where: { venueId, profileId, dayIndex },
    });
    const clash = shifts.find(
      (s) =>
        s.id !== excludeShiftId &&
        s.startMinutes < endMinutes &&
        startMinutes < s.endMinutes,
    );
    if (clash) {
      throw new BadRequestException(
        `That overlaps another shift this person already works on ${dayLabel(dayIndex)}.`,
      );
    }
  }

  private async markScheduleEdited(venueId: string) {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue?.schedulePublishedAt) return;
    await this.prisma.venue.update({
      where: { id: venueId },
      data: { scheduleUpdatedAfterPublishAt: new Date() },
    });
  }
}
