import {
  BadRequestException,
  Body,
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
import { Prisma, ShiftStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { isAdminRole } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { dayLabel, minutesToTime } from '../../common/mappers';
import {
  DEFAULT_PAY_PERIOD_ANCHOR,
  DEFAULT_PAY_PERIOD_LENGTH_DAYS,
  isIsoDate,
  isValidPeriodLength,
  isWeekLocked,
  todayIso,
  upcomingWeeks,
  weeksToCover,
  weekStartFor,
} from '../../common/pay-period';
import { EmailService } from '../../email/email.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';

type Scope = VenueScopedRequest['venueScope'];

const SHIFT_STATUSES = ['scheduled', 'open', 'covered'];
const SWAP_STATUSES = ['proposed', 'accepted', 'declined', 'approved', 'denied', 'cancelled'];

class AvailabilityBlockDto {
  @IsInt()
  dayIndex!: number;

  @IsInt()
  startMinutes!: number;

  @IsInt()
  endMinutes!: number;

  @IsBoolean()
  available!: boolean;
}

class SetAvailabilityDto {
  @IsString()
  weekStart!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AvailabilityBlockDto)
  rows!: AvailabilityBlockDto[];
}

class PayPeriodSettingsDto {
  @IsString()
  @IsOptional()
  anchor?: string;

  @IsInt()
  @IsOptional()
  lengthDays?: number;

  @IsBoolean()
  @IsOptional()
  availabilityUnlocked?: boolean;
}

class BlackoutDto {
  @IsString()
  startDate!: string;

  @IsString()
  @IsOptional()
  endDate?: string;

  @IsString()
  reason!: string;
}

class ShiftDto {
  @IsInt()
  dayIndex!: number;

  @IsInt()
  startMinutes!: number;

  @IsInt()
  endMinutes!: number;

  @IsString()
  jobTitle!: string;

  @IsString()
  station!: string;

  @IsString()
  @IsOptional()
  profileId?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

class AssignShiftDto {
  @IsString()
  @IsOptional()
  profileId?: string;
}

class LaborBudgetDto {
  @IsInt()
  @IsOptional()
  weeklyLaborBudgetHours?: number;
}

class TemplateDto {
  @IsString()
  name!: string;
}

class ApplyTemplateDto {
  @IsBoolean()
  replace!: boolean;
}

class CopyDayDto {
  @IsInt()
  fromDay!: number;

  @IsArray()
  toDays!: number[];
}

class RestoreShiftDto extends ShiftDto {
  @IsString()
  @IsIn(SHIFT_STATUSES)
  status!: ShiftStatus;
}

class RestoreShiftsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RestoreShiftDto)
  shifts!: RestoreShiftDto[];
}

class AutoScheduleAssignmentDto {
  @IsString()
  shiftId!: string;

  @IsString()
  profileId!: string;
}

class ApplyAutoScheduleDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutoScheduleAssignmentDto)
  assignments!: AutoScheduleAssignmentDto[];
}

class ProposeSwapDto {
  @IsString()
  myShiftId!: string;

  @IsString()
  targetProfileId!: string;

  @IsString()
  @IsOptional()
  targetShiftId?: string;

  @IsString()
  @IsOptional()
  note?: string;
}

class RespondSwapDto {
  @IsBoolean()
  accept!: boolean;
}

class ReviewSwapDto {
  @IsBoolean()
  approve!: boolean;
}

function ensureValidShiftWindow(dayIndex: number, startMinutes: number, endMinutes: number) {
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) {
    throw new BadRequestException('dayIndex must be between 0 and 6');
  }
  if (!Number.isInteger(startMinutes) || startMinutes < 0 || startMinutes > 1440) {
    throw new BadRequestException('Invalid start time');
  }
  if (!Number.isInteger(endMinutes) || endMinutes < 0 || endMinutes > 1440 || endMinutes <= startMinutes) {
    throw new BadRequestException('End time must be after start time');
  }
}

function schedulePublishState(venue: {
  schedulePublishedAt: Date | null;
  scheduleUpdatedAfterPublishAt: Date | null;
}) {
  const publishedAt = venue.schedulePublishedAt?.getTime() ?? null;
  const updatedAfterPublishAt = venue.scheduleUpdatedAfterPublishAt?.getTime() ?? null;
  return {
    status: !publishedAt ? 'draft' : updatedAfterPublishAt && updatedAfterPublishAt > publishedAt ? 'edited_after_publish' : 'published',
    publishedAt,
    updatedAfterPublishAt,
  };
}

type ShiftWithProfile = {
  id: string;
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
  jobTitle: string;
  station: string;
  notes: string | null;
  status: ShiftStatus;
  profileId: string | null;
  profile?: { fullName: string } | null;
};

@Controller('v1/scheduling')
export class SchedulingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
  ) {}

  @RequireSubscription()
  @Get('availability/me')
  async getMyAvailability(@VenueScope() scope: Scope) {
    if (!scope) return { payPeriod: { anchor: DEFAULT_PAY_PERIOD_ANCHOR, lengthDays: DEFAULT_PAY_PERIOD_LENGTH_DAYS, unlocked: false }, weeks: [] };
    const config = await this.payPeriodConfig(scope.venueId);
    const today = todayIso();
    const weekStarts = upcomingWeeks(today, weeksToCover(config.lengthDays));
    const rows = await this.prisma.availability.findMany({
      where: { profileId: scope.profileId, weekStart: { in: weekStarts } },
      orderBy: [{ dayIndex: 'asc' }, { startMinutes: 'asc' }],
    });
    const byWeek = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byWeek.get(row.weekStart) ?? [];
      list.push(row);
      byWeek.set(row.weekStart, list);
    }
    return {
      payPeriod: config,
      weeks: weekStarts.map((weekStart) => ({
        weekStart,
        locked: isWeekLocked({ weekStart, today, anchor: config.anchor, lengthDays: config.lengthDays, unlocked: config.unlocked }),
        days: (byWeek.get(weekStart) ?? []).map((row) => ({
          dayIndex: row.dayIndex,
          startMinutes: row.startMinutes,
          endMinutes: row.endMinutes,
          available: row.available,
        })),
      })),
    };
  }

  @RequireSubscription()
  @Post('availability/me')
  async setMyAvailability(@VenueScope() scope: Scope, @Body() body: SetAvailabilityDto) {
    if (!scope) throw new ForbiddenException('Profile does not belong to a venue');
    if (!isIsoDate(body.weekStart)) throw new BadRequestException('weekStart must be a YYYY-MM-DD date');
    const weekStart = weekStartFor(body.weekStart);
    const config = await this.payPeriodConfig(scope.venueId);
    if (isWeekLocked({ weekStart, today: todayIso(), anchor: config.anchor, lengthDays: config.lengthDays, unlocked: config.unlocked })) {
      throw new ForbiddenException('Availability for this week is locked. Ask a manager to unlock availability.');
    }
    await this.prisma.$transaction([
      this.prisma.availability.deleteMany({ where: { profileId: scope.profileId, weekStart } }),
      ...body.rows.map((row) =>
        this.prisma.availability.create({
          data: {
            venueId: scope.venueId,
            profileId: scope.profileId,
            weekStart,
            dayIndex: row.dayIndex,
            startMinutes: row.startMinutes,
            endMinutes: row.endMinutes,
            available: row.available,
          },
        }),
      ),
    ]);
    return { ok: true };
  }

  @RequireSubscription()
  @Get('availability/settings')
  async getAvailabilitySettings(@VenueScope() scope: Scope) {
    this.requireManager(scope);
    const config = await this.payPeriodConfig(scope!.venueId);
    return { anchor: config.anchor, lengthDays: config.lengthDays, availabilityUnlocked: config.unlocked };
  }

  @RequireSubscription()
  @Patch('availability/settings')
  async updateAvailabilitySettings(@VenueScope() scope: Scope, @Body() body: PayPeriodSettingsDto) {
    this.requireManager(scope);
    const data: Prisma.VenueUpdateInput = {};
    if (body.anchor !== undefined) {
      if (!isIsoDate(body.anchor)) throw new BadRequestException('anchor must be a YYYY-MM-DD date');
      // Normalize to the Sunday that starts the week so periods align to weeks.
      data.payPeriodAnchor = weekStartFor(body.anchor);
    }
    if (body.lengthDays !== undefined) {
      if (!isValidPeriodLength(body.lengthDays)) {
        throw new BadRequestException('Pay period must be a whole number of weeks (7, 14, 21, or 28 days).');
      }
      data.payPeriodLengthDays = body.lengthDays;
    }
    if (body.availabilityUnlocked !== undefined) data.availabilityUnlocked = body.availabilityUnlocked;
    await this.prisma.venue.update({ where: { id: scope!.venueId }, data });
    return { ok: true };
  }

  private async payPeriodConfig(venueId: string) {
    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: { payPeriodAnchor: true, payPeriodLengthDays: true, availabilityUnlocked: true },
    });
    return {
      anchor: venue?.payPeriodAnchor ?? DEFAULT_PAY_PERIOD_ANCHOR,
      lengthDays: venue?.payPeriodLengthDays ?? DEFAULT_PAY_PERIOD_LENGTH_DAYS,
      unlocked: venue?.availabilityUnlocked ?? false,
    };
  }

  @RequireSubscription()
  @Get('blackouts')
  async listBlackouts(@VenueScope() scope: Scope) {
    if (!scope) return [];
    const rows = await this.prisma.blackoutDate.findMany({
      where: { venueId: scope.venueId },
      orderBy: { startDate: 'asc' },
    });
    return rows.map((row) => ({ _id: row.id, startDate: row.startDate, endDate: row.endDate, reason: row.reason }));
  }

  @RequireSubscription()
  @Post('blackouts')
  async addBlackout(@VenueScope() scope: Scope, @Body() body: BlackoutDto) {
    this.requireManager(scope);
    const startDate = body.startDate.trim();
    const endDate = body.endDate?.trim() || startDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new BadRequestException('Dates must be in YYYY-MM-DD format');
    }
    if (endDate < startDate) throw new BadRequestException('End date must be on or after the start date');
    const row = await this.prisma.blackoutDate.create({
      data: {
        venueId: scope!.venueId,
        startDate,
        endDate,
        reason: body.reason.trim() || 'Blackout',
        createdBy: scope!.profileId,
      },
    });
    return row.id;
  }

  @RequireSubscription()
  @Delete('blackouts/:id')
  async removeBlackout(@VenueScope() scope: Scope, @Param('id') id: string) {
    this.requireManager(scope);
    const row = await this.prisma.blackoutDate.findFirst({ where: { id, venueId: scope!.venueId } });
    if (!row) throw new NotFoundException('Blackout not found');
    await this.prisma.blackoutDate.delete({ where: { id: row.id } });
    return { ok: true };
  }

  @RequireSubscription()
  @Get('manager')
  async getManagerSchedule(@VenueScope() scope: Scope) {
    this.requireManager(scope);
    const [venue, shifts, staff, availability] = await Promise.all([
      this.prisma.venue.findUniqueOrThrow({ where: { id: scope!.venueId } }),
      this.prisma.scheduleShift.findMany({
        where: { venueId: scope!.venueId },
        include: { profile: true },
        orderBy: [{ dayIndex: 'asc' }, { startMinutes: 'asc' }],
      }),
      this.prisma.profile.findMany({ where: { venueId: scope!.venueId }, orderBy: { fullName: 'asc' } }),
      // The weekly schedule grid is day-of-week based; show the current week's
      // dated availability for conflict highlighting.
      this.prisma.availability.findMany({ where: { venueId: scope!.venueId, weekStart: weekStartFor(todayIso()) } }),
    ]);
    const availabilityByProfile = new Map<string, typeof availability>();
    for (const row of availability) {
      const rows = availabilityByProfile.get(row.profileId) ?? [];
      rows.push(row);
      availabilityByProfile.set(row.profileId, rows);
    }
    const weeklyMinutes = new Map<string, number>();
    for (const shift of shifts) {
      if (!shift.profileId) continue;
      weeklyMinutes.set(shift.profileId, (weeklyMinutes.get(shift.profileId) ?? 0) + Math.max(0, shift.endMinutes - shift.startMinutes));
    }
    const totalScheduledMinutes = shifts.reduce((sum, shift) => sum + Math.max(0, shift.endMinutes - shift.startMinutes), 0);
    return {
      shifts: shifts.map((shift) => this.mapManagerShift(shift)),
      staff: staff.map((member) => {
        const mins = weeklyMinutes.get(member.id) ?? 0;
        return {
          _id: member.id,
          fullName: member.fullName,
          role: member.role,
          jobTitle: member.jobTitle,
          weeklyHours: Math.round((mins / 60) * 10) / 10,
          overtime: mins > 40 * 60,
          availability: (availabilityByProfile.get(member.id) ?? []).map((row) => ({
            dayIndex: row.dayIndex,
            startMinutes: row.startMinutes,
            endMinutes: row.endMinutes,
            available: row.available,
          })),
        };
      }),
      laborBudgetHours: venue.weeklyLaborBudgetHours ?? null,
      totalScheduledHours: Math.round((totalScheduledMinutes / 60) * 10) / 10,
      publishState: schedulePublishState(venue),
    };
  }

  @RequireSubscription()
  @Post('shifts')
  async createShift(@VenueScope() scope: Scope, @Body() body: ShiftDto) {
    this.requireManager(scope);
    ensureValidShiftWindow(body.dayIndex, body.startMinutes, body.endMinutes);
    if (body.profileId) await this.assertVenueMember(scope!.venueId, body.profileId);
    if (body.profileId) await this.assertNoDoubleBook(scope!.venueId, body.profileId, body.dayIndex, body.startMinutes, body.endMinutes);
    const shift = await this.prisma.scheduleShift.create({
      data: {
        venueId: scope!.venueId,
        profileId: body.profileId,
        dayIndex: body.dayIndex,
        startMinutes: body.startMinutes,
        endMinutes: body.endMinutes,
        jobTitle: body.jobTitle.trim() || 'Staff',
        station: body.station.trim() || 'Floor',
        notes: body.notes?.trim() || null,
        status: body.profileId ? 'scheduled' : 'open',
      },
    });
    await this.markScheduleEdited(scope!.venueId);
    if (body.profileId) {
      await this.notifications.notifyProfile({
        venueId: scope!.venueId,
        profileId: body.profileId,
        kind: 'shift_assigned',
        title: 'New shift assigned',
        body: `${dayLabel(body.dayIndex)} ${minutesToTime(body.startMinutes)}-${minutesToTime(body.endMinutes)} · ${body.jobTitle}`,
      });
      void this.email.sendToProfile(body.profileId, {
        subject: 'New shift assigned',
        text: `You were assigned a new shift:\n\n${dayLabel(body.dayIndex)} ${minutesToTime(body.startMinutes)}-${minutesToTime(body.endMinutes)}\n${body.jobTitle} at ${body.station.trim() || 'Floor'}`,
      });
    }
    return shift.id;
  }

  @RequireSubscription()
  @Patch('shifts/:id')
  async updateShift(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: ShiftDto) {
    this.requireManager(scope);
    ensureValidShiftWindow(body.dayIndex, body.startMinutes, body.endMinutes);
    const shift = await this.getVenueShift(scope!.venueId, id);
    if (shift.profileId) await this.assertNoDoubleBook(scope!.venueId, shift.profileId, body.dayIndex, body.startMinutes, body.endMinutes, shift.id);
    await this.prisma.scheduleShift.update({
      where: { id: shift.id },
      data: {
        dayIndex: body.dayIndex,
        startMinutes: body.startMinutes,
        endMinutes: body.endMinutes,
        jobTitle: body.jobTitle.trim() || 'Staff',
        station: body.station.trim() || 'Floor',
        notes: body.notes?.trim() || null,
      },
    });
    await this.markScheduleEdited(scope!.venueId);
    if (shift.profileId) {
      void this.email.sendToProfile(shift.profileId, {
        subject: 'Your schedule changed',
        text: `One of your shifts was updated:\n\n${dayLabel(body.dayIndex)} ${minutesToTime(body.startMinutes)}-${minutesToTime(body.endMinutes)}\n${body.jobTitle} at ${body.station.trim() || 'Floor'}`,
      });
    }
    return { ok: true };
  }

  @RequireSubscription()
  @Patch('shifts/:id/assign')
  async assignShift(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: AssignShiftDto) {
    this.requireManager(scope);
    const shift = await this.getVenueShift(scope!.venueId, id);
    if (!body.profileId) {
      await this.prisma.scheduleShift.update({ where: { id: shift.id }, data: { profileId: null, status: 'open' } });
      await this.markScheduleEdited(scope!.venueId);
      if (shift.profileId) {
        void this.email.sendToProfile(shift.profileId, {
          subject: 'Your shift assignment changed',
          text: `You were removed from this shift:\n\n${this.shiftLabel(shift)}\n${shift.jobTitle} at ${shift.station}`,
        });
      }
      return { ok: true };
    }
    await this.assertVenueMember(scope!.venueId, body.profileId);
    await this.assertNoDoubleBook(scope!.venueId, body.profileId, shift.dayIndex, shift.startMinutes, shift.endMinutes, shift.id);
    await this.prisma.scheduleShift.update({ where: { id: shift.id }, data: { profileId: body.profileId, status: 'scheduled' } });
    await this.markScheduleEdited(scope!.venueId);
    void this.email.sendToProfile(body.profileId, {
      subject: 'Shift assigned',
      text: `You were assigned this shift:\n\n${this.shiftLabel(shift)}\n${shift.jobTitle} at ${shift.station}`,
    });
    if (shift.profileId && shift.profileId !== body.profileId) {
      void this.email.sendToProfile(shift.profileId, {
        subject: 'Your shift assignment changed',
        text: `You were removed from this shift:\n\n${this.shiftLabel(shift)}\n${shift.jobTitle} at ${shift.station}`,
      });
    }
    return { ok: true };
  }

  @RequireSubscription()
  @Delete('shifts/:id')
  async deleteShift(@VenueScope() scope: Scope, @Param('id') id: string) {
    this.requireManager(scope);
    const shift = await this.getVenueShift(scope!.venueId, id);
    await this.prisma.scheduleShift.delete({ where: { id: shift.id } });
    await this.markScheduleEdited(scope!.venueId);
    if (shift.profileId) {
      void this.email.sendToProfile(shift.profileId, {
        subject: 'A shift was removed from your schedule',
        text: `This shift was removed from your schedule:\n\n${this.shiftLabel(shift)}\n${shift.jobTitle} at ${shift.station}`,
      });
    }
    return {
      dayIndex: shift.dayIndex,
      startMinutes: shift.startMinutes,
      endMinutes: shift.endMinutes,
      jobTitle: shift.jobTitle,
      station: shift.station,
      status: shift.status,
      profileId: shift.profileId,
      notes: shift.notes,
    };
  }

  @RequireSubscription()
  @Get('me')
  async getMySchedule(@VenueScope() scope: Scope) {
    if (!scope) return { mine: [], open: [], roster: [] };
    const shifts = await this.prisma.scheduleShift.findMany({
      where: { venueId: scope.venueId },
      include: { profile: true },
      orderBy: [{ dayIndex: 'asc' }, { startMinutes: 'asc' }],
    });
    const mine = shifts.filter((shift) => shift.profileId === scope.profileId);
    const open = shifts.filter((shift) => shift.status === 'open' && !shift.profileId);
    const roster = [0, 1, 2, 3, 4, 5, 6].map((dayIndex) => ({
      dayIndex,
      dayLabel: dayLabel(dayIndex),
      coworkers: shifts
        .filter((shift) => shift.dayIndex === dayIndex && shift.profileId && shift.profileId !== scope.profileId)
        .map((shift) => ({
          profileId: shift.profileId,
          memberName: shift.profile?.fullName ?? 'Teammate',
          jobTitle: shift.jobTitle,
          startTime: minutesToTime(shift.startMinutes),
          endTime: minutesToTime(shift.endMinutes),
        })),
    }));
    return {
      mine: mine.map((shift) => this.mapEmployeeShift(shift)),
      open: open.map((shift) => this.mapEmployeeShift(shift)),
      roster,
    };
  }

  @RequireSubscription()
  @Post('shifts/:id/claim')
  async claimOpenShift(@VenueScope() scope: Scope, @Param('id') id: string) {
    if (!scope) throw new ForbiddenException('Profile does not belong to a venue');
    const shift = await this.getVenueShift(scope.venueId, id);
    if (shift.profileId || shift.status !== 'open') throw new BadRequestException('This shift is no longer open');
    await this.assertNoDoubleBook(scope.venueId, scope.profileId, shift.dayIndex, shift.startMinutes, shift.endMinutes, shift.id);
    // Claim atomically: only the request that still sees the shift open+unassigned
    // wins, so two staff tapping "claim" simultaneously can't both take it.
    const claimed = await this.prisma.scheduleShift.updateMany({
      where: { id: shift.id, venueId: scope.venueId, status: 'open', profileId: null },
      data: { profileId: scope.profileId, status: 'covered' },
    });
    if (claimed.count === 0) throw new BadRequestException('This shift is no longer open');
    await this.markScheduleEdited(scope.venueId);
    await this.notifications.notifyManagers({
      venueId: scope.venueId,
      kind: 'shift_assigned',
      title: 'Open shift covered',
      body: `${scope.fullName} picked up ${dayLabel(shift.dayIndex)} ${minutesToTime(shift.startMinutes)}-${minutesToTime(shift.endMinutes)}.`,
    });
    void this.email.sendToVenueManagers(scope.venueId, {
      subject: 'Open shift covered',
      text: `${scope.fullName} picked up ${this.shiftLabel(shift)}.\n\n${shift.jobTitle} at ${shift.station}`,
    });
    return { ok: true };
  }

  @RequireSubscription()
  @Post('publish')
  async publishSchedule(@VenueScope() scope: Scope) {
    this.requireManager(scope);
    const shifts = await this.prisma.scheduleShift.findMany({ where: { venueId: scope!.venueId } });
    const assigned = shifts.filter((shift) => shift.profileId).length;
    const open = shifts.filter((shift) => shift.status === 'open').length;
    await this.prisma.venue.update({
      where: { id: scope!.venueId },
      data: {
        schedulePublishedAt: new Date(),
        schedulePublishedById: scope!.profileId,
        scheduleUpdatedAfterPublishAt: null,
      },
    });
    await this.notifications.notifyStaff({
      venueId: scope!.venueId,
      kind: 'schedule_published',
      title: 'Schedule posted',
      body: `${assigned} shift${assigned === 1 ? '' : 's'} scheduled${open > 0 ? `, ${open} open to pick up` : ''}.`,
    });
    void this.email.sendToVenueStaff(scope!.venueId, {
      subject: 'Schedule posted',
      text: `The schedule has been posted.\n\n${assigned} shift${assigned === 1 ? '' : 's'} scheduled${open > 0 ? `, ${open} open to pick up` : ''}.`,
    });
    return { notified: assigned };
  }

  @RequireSubscription()
  @Patch('labor-budget')
  async setLaborBudget(@VenueScope() scope: Scope, @Body() body: LaborBudgetDto) {
    this.requireManager(scope);
    await this.prisma.venue.update({
      where: { id: scope!.venueId },
      data: { weeklyLaborBudgetHours: body.weeklyLaborBudgetHours ?? null },
    });
    return { ok: true };
  }

  @RequireSubscription()
  @Get('templates')
  async listScheduleTemplates(@VenueScope() scope: Scope) {
    this.requireManager(scope);
    const rows = await this.prisma.scheduleTemplate.findMany({
      where: { venueId: scope!.venueId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      _id: row.id,
      name: row.name,
      shiftCount: Array.isArray(row.shifts) ? row.shifts.length : 0,
      createdAt: row.createdAt.getTime(),
    }));
  }

  @RequireSubscription()
  @Post('templates')
  async saveScheduleTemplate(@VenueScope() scope: Scope, @Body() body: TemplateDto) {
    this.requireManager(scope);
    const name = body.name.trim();
    if (!name) throw new BadRequestException('Enter a template name');
    const shifts = await this.prisma.scheduleShift.findMany({ where: { venueId: scope!.venueId } });
    const row = await this.prisma.scheduleTemplate.create({
      data: {
        venueId: scope!.venueId,
        name,
        shifts: shifts.map((shift) => ({
          dayIndex: shift.dayIndex,
          startMinutes: shift.startMinutes,
          endMinutes: shift.endMinutes,
          jobTitle: shift.jobTitle,
          station: shift.station,
        })) as Prisma.InputJsonValue,
      },
    });
    return row.id;
  }

  @RequireSubscription()
  @Post('templates/:id/apply')
  async applyScheduleTemplate(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: ApplyTemplateDto) {
    this.requireManager(scope);
    const template = await this.prisma.scheduleTemplate.findFirst({ where: { id, venueId: scope!.venueId } });
    if (!template) throw new NotFoundException('Template not found');
    const slots = Array.isArray(template.shifts) ? template.shifts : [];
    const creates = slots.map((slot) => {
      const row = slot as { dayIndex: number; startMinutes: number; endMinutes: number; jobTitle: string; station: string };
      return this.prisma.scheduleShift.create({
        data: {
          venueId: scope!.venueId,
          dayIndex: row.dayIndex,
          startMinutes: row.startMinutes,
          endMinutes: row.endMinutes,
          jobTitle: row.jobTitle,
          station: row.station,
          status: 'open',
        },
      });
    });
    await this.prisma.$transaction([
      ...(body.replace ? [this.prisma.scheduleShift.deleteMany({ where: { venueId: scope!.venueId } })] : []),
      ...creates,
    ]);
    await this.markScheduleEdited(scope!.venueId);
    return { added: slots.length };
  }

  @RequireSubscription()
  @Delete('templates/:id')
  async deleteScheduleTemplate(@VenueScope() scope: Scope, @Param('id') id: string) {
    this.requireManager(scope);
    const template = await this.prisma.scheduleTemplate.findFirst({ where: { id, venueId: scope!.venueId } });
    if (!template) throw new NotFoundException('Template not found');
    await this.prisma.scheduleTemplate.delete({ where: { id: template.id } });
    return { ok: true };
  }

  @RequireSubscription()
  @Post('copy-day')
  async copyDayShifts(@VenueScope() scope: Scope, @Body() body: CopyDayDto) {
    this.requireManager(scope);
    const source = await this.prisma.scheduleShift.findMany({
      where: { venueId: scope!.venueId, dayIndex: body.fromDay },
    });
    const creates = body.toDays
      .filter((day) => day !== body.fromDay)
      .flatMap((day) =>
        source.map((shift) =>
          this.prisma.scheduleShift.create({
            data: {
              venueId: scope!.venueId,
              dayIndex: day,
              startMinutes: shift.startMinutes,
              endMinutes: shift.endMinutes,
              jobTitle: shift.jobTitle,
              station: shift.station,
              status: 'open',
            },
          }),
        ),
      );
    await this.prisma.$transaction(creates);
    await this.markScheduleEdited(scope!.venueId);
    return { added: creates.length };
  }

  @RequireSubscription()
  @Post('clear-week')
  async clearWeek(@VenueScope() scope: Scope) {
    this.requireManager(scope);
    const shifts = await this.prisma.scheduleShift.findMany({ where: { venueId: scope!.venueId } });
    const snapshots = shifts.map((shift) => ({
      dayIndex: shift.dayIndex,
      startMinutes: shift.startMinutes,
      endMinutes: shift.endMinutes,
      jobTitle: shift.jobTitle,
      station: shift.station,
      status: shift.status,
      profileId: shift.profileId,
      notes: shift.notes,
    }));
    await this.prisma.scheduleShift.deleteMany({ where: { venueId: scope!.venueId } });
    await this.markScheduleEdited(scope!.venueId);
    return { removed: shifts.length, shifts: snapshots };
  }

  @RequireSubscription()
  @Post('restore-shifts')
  async restoreShifts(@VenueScope() scope: Scope, @Body() body: RestoreShiftsDto) {
    this.requireManager(scope);
    const creates = [];
    for (const shift of body.shifts) {
      ensureValidShiftWindow(shift.dayIndex, shift.startMinutes, shift.endMinutes);
      let profileId = shift.profileId;
      if (profileId) {
        const member = await this.prisma.profile.findFirst({ where: { id: profileId, venueId: scope!.venueId } });
        if (!member) profileId = undefined;
      }
      creates.push(this.prisma.scheduleShift.create({
        data: {
          venueId: scope!.venueId,
          profileId,
          dayIndex: shift.dayIndex,
          startMinutes: shift.startMinutes,
          endMinutes: shift.endMinutes,
          jobTitle: shift.jobTitle,
          station: shift.station,
          status: profileId ? shift.status : 'open',
          notes: shift.notes,
        },
      }));
    }
    await this.prisma.$transaction(creates);
    await this.markScheduleEdited(scope!.venueId);
    return { restored: creates.length };
  }

  @RequireSubscription()
  @Get('auto-schedule/preview')
  async previewAutoSchedule(@VenueScope() scope: Scope, @Query('weekStartDate') _weekStartDate?: string) {
    this.requireManager(scope);
    const [shifts, staff] = await Promise.all([
      this.prisma.scheduleShift.findMany({
        where: { venueId: scope!.venueId },
        include: { profile: true },
        orderBy: [{ dayIndex: 'asc' }, { startMinutes: 'asc' }],
      }),
      this.prisma.profile.findMany({ where: { venueId: scope!.venueId }, orderBy: { fullName: 'asc' } }),
    ]);
    const openShifts = shifts.filter((shift) => shift.status === 'open' && !shift.profileId);
    const assignments = new Map<string, number>();
    const proposals = openShifts.map((shift) => {
      const candidate = staff.find((member) => {
        const assignedMinutes = assignments.get(member.id) ?? 0;
        const roleMatch =
          member.jobTitle.toLowerCase().includes(shift.jobTitle.toLowerCase()) ||
          shift.jobTitle.toLowerCase().includes(member.jobTitle.toLowerCase()) ||
          member.role === 'staff' ||
          member.role === 'server';
        const overlaps = shifts.some((other) =>
          other.profileId === member.id &&
          other.dayIndex === shift.dayIndex &&
          other.startMinutes < shift.endMinutes &&
          other.endMinutes > shift.startMinutes,
        );
        return roleMatch && !overlaps && assignedMinutes < 40 * 60;
      });
      if (candidate) assignments.set(candidate.id, (assignments.get(candidate.id) ?? 0) + Math.max(0, shift.endMinutes - shift.startMinutes));
      return {
        shiftId: shift.id,
        dayLabel: dayLabel(shift.dayIndex),
        startTime: minutesToTime(shift.startMinutes),
        endTime: minutesToTime(shift.endMinutes),
        jobTitle: shift.jobTitle,
        profileId: candidate?.id ?? null,
        reason: candidate ? 'assigned' : 'no_role_match',
      };
    });
    const filled = proposals.filter((proposal) => proposal.profileId).length;
    return {
      openCount: openShifts.length,
      filled,
      unfilled: openShifts.length - filled,
      proposals,
    };
  }

  @RequireSubscription()
  @Post('auto-schedule/apply')
  async applyAutoSchedule(@VenueScope() scope: Scope, @Body() body: ApplyAutoScheduleDto) {
    this.requireManager(scope);
    let assigned = 0;
    let skipped = 0;
    const assignedShifts: Array<{ profileId: string; label: string; jobTitle: string; station: string }> = [];
    for (const assignment of body.assignments) {
      const shift = await this.getVenueShift(scope!.venueId, assignment.shiftId);
      if (shift.profileId || shift.status !== 'open') {
        skipped += 1;
        continue;
      }
      await this.assertVenueMember(scope!.venueId, assignment.profileId);
      try {
        await this.assertNoDoubleBook(scope!.venueId, assignment.profileId, shift.dayIndex, shift.startMinutes, shift.endMinutes, shift.id);
      } catch {
        skipped += 1;
        continue;
      }
      await this.prisma.scheduleShift.update({
        where: { id: shift.id },
        data: { profileId: assignment.profileId, status: 'scheduled' },
      });
      assignedShifts.push({
        profileId: assignment.profileId,
        label: this.shiftLabel(shift),
        jobTitle: shift.jobTitle,
        station: shift.station,
      });
      assigned += 1;
    }
    if (assigned > 0) await this.markScheduleEdited(scope!.venueId);
    const assignedByProfile = new Map<string, typeof assignedShifts>();
    for (const assignedShift of assignedShifts) {
      const profileAssignments = assignedByProfile.get(assignedShift.profileId) ?? [];
      profileAssignments.push(assignedShift);
      assignedByProfile.set(assignedShift.profileId, profileAssignments);
    }
    const assignedProfiles = assignedByProfile.size
      ? await this.prisma.profile.findMany({
          where: { id: { in: Array.from(assignedByProfile.keys()) } },
          select: { id: true, email: true },
        })
      : [];
    for (const profile of assignedProfiles) {
      const profileAssignments = assignedByProfile.get(profile.id) ?? [];
      void this.email.send({
        to: profile.email,
        subject: profileAssignments.length === 1 ? 'New shift assigned' : 'New shifts assigned',
        text: `You were assigned ${profileAssignments.length === 1 ? 'a new shift' : 'new shifts'}:\n\n${profileAssignments
          .map((shift) => `${shift.label}\n${shift.jobTitle} at ${shift.station}`)
          .join('\n\n')}`,
      });
    }
    return { assigned, skipped };
  }

  @RequireSubscription()
  @Post('swaps')
  async proposeShiftSwap(@VenueScope() scope: Scope, @Body() body: ProposeSwapDto) {
    if (!scope) throw new ForbiddenException('Profile does not belong to a venue');
    const myShift = await this.getVenueShift(scope.venueId, body.myShiftId);
    if (myShift.profileId !== scope.profileId) throw new ForbiddenException('That is not your shift');
    const target = await this.assertVenueMember(scope.venueId, body.targetProfileId);
    if (target.id === scope.profileId) throw new BadRequestException('Choose a teammate');
    if (body.targetShiftId) {
      const targetShift = await this.getVenueShift(scope.venueId, body.targetShiftId);
      if (targetShift.profileId !== target.id) throw new BadRequestException("That is not the teammate's shift");
    }
    const swap = await this.prisma.shiftSwap.create({
      data: {
        venueId: scope.venueId,
        requesterProfileId: scope.profileId,
        requesterShiftId: myShift.id,
        targetProfileId: target.id,
        targetShiftId: body.targetShiftId,
        status: 'proposed',
        note: body.note?.trim() || null,
      },
    });
    await this.notifications.notifyProfile({
      venueId: scope.venueId,
      profileId: target.id,
      kind: 'swap_proposed',
      title: 'Shift swap proposed',
      body: `${scope.fullName} wants to swap ${this.shiftLabel(myShift)}.`,
    });
    void this.email.sendToProfile(target.id, {
      subject: 'Shift swap proposed',
      text: `${scope.fullName} wants to swap ${this.shiftLabel(myShift)}.${body.note?.trim() ? `\n\nNote: ${body.note.trim()}` : ''}`,
    });
    return swap.id;
  }

  @RequireSubscription()
  @Patch('swaps/:id/respond')
  async respondToShiftSwap(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: RespondSwapDto) {
    if (!scope) throw new ForbiddenException('Profile does not belong to a venue');
    const swap = await this.prisma.shiftSwap.findFirst({ where: { id, venueId: scope.venueId } });
    if (!swap || swap.targetProfileId !== scope.profileId) throw new ForbiddenException('Not authorized');
    if (swap.status !== 'proposed') throw new BadRequestException('This swap is no longer open');
    // Atomic transition so a double-tap can't respond twice / re-fire notifications.
    const responded = await this.prisma.shiftSwap.updateMany({
      where: { id: swap.id, status: 'proposed' },
      data: { status: body.accept ? 'accepted' : 'declined' },
    });
    if (responded.count === 0) throw new BadRequestException('This swap is no longer open');
    if (body.accept) {
      await this.notifications.notifyManagers({
        venueId: scope.venueId,
        kind: 'swap_proposed',
        title: 'Swap needs approval',
        body: `${scope.fullName} accepted a shift swap. Approve it in the schedule.`,
      });
      void this.email.sendToVenueManagers(scope.venueId, {
        subject: 'Shift swap needs approval',
        text: `${scope.fullName} accepted a shift swap. Approve it in the schedule.`,
      });
    }
    return { ok: true };
  }

  @RequireSubscription()
  @Patch('swaps/:id/review')
  async reviewShiftSwap(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: ReviewSwapDto) {
    this.requireManager(scope);
    const swap = await this.prisma.shiftSwap.findFirst({ where: { id, venueId: scope!.venueId } });
    if (!swap) throw new NotFoundException('Swap not found');
    if (!['accepted', 'proposed'].includes(swap.status)) throw new BadRequestException('Swap is not pending');
    if (body.approve) {
      const requesterShift = await this.getVenueShift(scope!.venueId, swap.requesterShiftId);
      const targetShift = swap.targetShiftId ? await this.getVenueShift(scope!.venueId, swap.targetShiftId) : null;
      await this.assertNoDoubleBook(
        scope!.venueId,
        swap.targetProfileId,
        requesterShift.dayIndex,
        requesterShift.startMinutes,
        requesterShift.endMinutes,
        requesterShift.id,
        targetShift?.id,
      );
      if (targetShift) {
        await this.assertNoDoubleBook(
          scope!.venueId,
          swap.requesterProfileId,
          targetShift.dayIndex,
          targetShift.startMinutes,
          targetShift.endMinutes,
          targetShift.id,
          requesterShift.id,
        );
      }
      await this.prisma.$transaction([
        this.prisma.scheduleShift.update({ where: { id: requesterShift.id }, data: { profileId: swap.targetProfileId, status: 'scheduled' } }),
        ...(targetShift
          ? [this.prisma.scheduleShift.update({ where: { id: targetShift.id }, data: { profileId: swap.requesterProfileId, status: 'scheduled' } })]
          : []),
        this.prisma.shiftSwap.update({ where: { id: swap.id }, data: { status: 'approved' } }),
      ]);
      await this.markScheduleEdited(scope!.venueId);
    } else {
      await this.prisma.shiftSwap.update({ where: { id: swap.id }, data: { status: 'denied' } });
    }
    await this.notifications.notifyProfile({
      venueId: scope!.venueId,
      profileId: swap.requesterProfileId,
      kind: 'swap_reviewed',
      title: `Swap ${body.approve ? 'approved' : 'denied'}`,
      body: `Your shift swap was ${body.approve ? 'approved' : 'denied'}.`,
    });
    void this.email.sendToProfile(swap.requesterProfileId, {
      subject: `Shift swap ${body.approve ? 'approved' : 'denied'}`,
      text: `Your shift swap was ${body.approve ? 'approved' : 'denied'}.`,
    });
    await this.notifications.notifyProfile({
      venueId: scope!.venueId,
      profileId: swap.targetProfileId,
      kind: 'swap_reviewed',
      title: `Swap ${body.approve ? 'approved' : 'denied'}`,
      body: `A shift swap was ${body.approve ? 'approved' : 'denied'}.`,
    });
    void this.email.sendToProfile(swap.targetProfileId, {
      subject: `Shift swap ${body.approve ? 'approved' : 'denied'}`,
      text: `A shift swap was ${body.approve ? 'approved' : 'denied'}.`,
    });
    return { ok: true };
  }

  @RequireSubscription()
  @Get('swaps/me')
  async getMyShiftSwaps(@VenueScope() scope: Scope) {
    if (!scope) return [];
    const swaps = await this.prisma.shiftSwap.findMany({
      where: {
        venueId: scope.venueId,
        OR: [{ requesterProfileId: scope.profileId }, { targetProfileId: scope.profileId }],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return this.mapSwaps(scope.venueId, swaps, scope.profileId);
  }

  @RequireSubscription()
  @Get('swaps')
  async listShiftSwaps(@VenueScope() scope: Scope) {
    this.requireManager(scope);
    const swaps = await this.prisma.shiftSwap.findMany({
      where: { venueId: scope!.venueId, status: { in: ['proposed', 'accepted'] } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return this.mapSwaps(scope!.venueId, swaps, null);
  }

  private requireManager(scope: Scope): asserts scope is NonNullable<Scope> {
    if (!scope || !isAdminRole(scope.role)) throw new ForbiddenException('Not authorized');
  }

  private async assertVenueMember(venueId: string, profileId: string) {
    const member = await this.prisma.profile.findFirst({ where: { id: profileId, venueId } });
    if (!member) throw new BadRequestException('Staff member is not in this venue');
    return member;
  }

  private async getVenueShift(venueId: string, shiftId: string) {
    const shift = await this.prisma.scheduleShift.findFirst({ where: { id: shiftId, venueId } });
    if (!shift) throw new NotFoundException('Shift not found');
    return shift;
  }

  private async assertNoDoubleBook(venueId: string, profileId: string, dayIndex: number, startMinutes: number, endMinutes: number, ...excludeShiftIds: Array<string | undefined>) {
    const excluded = excludeShiftIds.filter((id): id is string => Boolean(id));
    const overlapping = await this.prisma.scheduleShift.findFirst({
      where: {
        venueId,
        profileId,
        dayIndex,
        ...(excluded.length > 0 ? { id: { notIn: excluded } } : {}),
        startMinutes: { lt: endMinutes },
        endMinutes: { gt: startMinutes },
      },
    });
    if (overlapping) throw new BadRequestException('This assignment overlaps another shift.');
  }

  private markScheduleEdited(venueId: string) {
    return this.prisma.venue.update({
      where: { id: venueId },
      data: { scheduleUpdatedAfterPublishAt: new Date() },
    });
  }

  private mapManagerShift(shift: ShiftWithProfile) {
    return {
      _id: shift.id,
      dayIndex: shift.dayIndex,
      dayLabel: dayLabel(shift.dayIndex),
      startMinutes: shift.startMinutes,
      endMinutes: shift.endMinutes,
      startTime: minutesToTime(shift.startMinutes),
      endTime: minutesToTime(shift.endMinutes),
      jobTitle: shift.jobTitle,
      station: shift.station,
      notes: shift.notes,
      status: shift.status,
      profileId: shift.profileId,
      memberName: shift.profileId ? shift.profile?.fullName ?? null : null,
      conflict: false,
    };
  }

  private mapEmployeeShift(shift: ShiftWithProfile) {
    return {
      _id: shift.id,
      dayIndex: shift.dayIndex,
      dayLabel: dayLabel(shift.dayIndex),
      startTime: minutesToTime(shift.startMinutes),
      endTime: minutesToTime(shift.endMinutes),
      memberId: shift.profileId,
      memberName: shift.profile?.fullName ?? null,
      jobTitle: shift.jobTitle,
      station: shift.station,
      status: shift.status,
      notes: shift.notes ?? undefined,
    };
  }

  private shiftLabel(shift: { dayIndex: number; startMinutes: number; endMinutes: number }) {
    return `${dayLabel(shift.dayIndex)} ${minutesToTime(shift.startMinutes)}-${minutesToTime(shift.endMinutes)}`;
  }

  private async mapSwaps(venueId: string, swaps: Array<{ id: string; status: string; note: string | null; requesterProfileId: string; targetProfileId: string; requesterShiftId: string; targetShiftId: string | null; createdAt: Date }>, meId: string | null) {
    const [staff, shifts] = await Promise.all([
      this.prisma.profile.findMany({ where: { venueId } }),
      this.prisma.scheduleShift.findMany({ where: { venueId } }),
    ]);
    const nameById = new Map(staff.map((member) => [member.id, member.fullName]));
    const shiftById = new Map(shifts.map((shift) => [shift.id, shift]));
    return swaps
      .filter((swap) => SWAP_STATUSES.includes(swap.status))
      .map((swap) => ({
        _id: swap.id,
        status: swap.status,
        note: swap.note,
        requesterName: nameById.get(swap.requesterProfileId) ?? 'Teammate',
        targetName: nameById.get(swap.targetProfileId) ?? 'Teammate',
        requesterShift: this.shiftLabel(shiftById.get(swap.requesterShiftId) ?? { dayIndex: 0, startMinutes: 0, endMinutes: 0 }),
        targetShift: swap.targetShiftId && shiftById.get(swap.targetShiftId) ? this.shiftLabel(shiftById.get(swap.targetShiftId)!) : null,
        direction: meId === swap.targetProfileId ? 'incoming' : meId === swap.requesterProfileId ? 'outgoing' : 'other',
        createdAt: swap.createdAt.getTime(),
      }));
  }
}
