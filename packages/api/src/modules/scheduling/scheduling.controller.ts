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
import { Availability, Prisma, ShiftStatus } from '@prisma/client';
import { Type, plainToInstance } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
  Min,
  Max,
  validateSync,
} from 'class-validator';
import { isAdminRole } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { dayLabel, minutesToTime } from '../../common/mappers';
import {
  addDays,
  DEFAULT_PAY_PERIOD_ANCHOR,
  DEFAULT_PAY_PERIOD_LENGTH_DAYS,
  isIsoDate,
  isValidPeriodLength,
  isWeekLocked,
  todayInZone,
  upcomingWeeks,
  weeksToCover,
  weekStartFor,
} from '../../common/pay-period';
import { withSerializableRetry } from '../../common/tx-retry';
import { zonedDayOfWeek } from '../../common/venue-time';
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

class TemplateShiftDto {
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

  @IsString()
  @IsOptional()
  notes?: string;
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
  @IsString()
  @IsOptional()
  weekStartDate?: string;

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

type TemplateShiftSlot = {
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
  jobTitle: string;
  station: string;
  notes?: string | null;
};

type AvailabilityWindow = Pick<Availability, 'dayIndex' | 'startMinutes' | 'endMinutes' | 'available'>;

function availabilityCovers(rows: AvailabilityWindow[] | undefined, shift: { dayIndex: number; startMinutes: number; endMinutes: number }) {
  const dayRows = (rows ?? []).filter((row) => row.dayIndex === shift.dayIndex);
  if (dayRows.length === 0) return false;
  const blocked = dayRows.some((row) =>
    !row.available &&
    row.startMinutes < shift.endMinutes &&
    row.endMinutes > shift.startMinutes,
  );
  if (blocked) return false;
  return dayRows.some((row) => row.available && row.startMinutes <= shift.startMinutes && row.endMinutes >= shift.endMinutes);
}

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
    const today = todayInZone(config.timezone);
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
    const today = todayInZone(config.timezone);
    if (isWeekLocked({ weekStart, today, anchor: config.anchor, lengthDays: config.lengthDays, unlocked: config.unlocked })) {
      throw new ForbiddenException('Availability for this week is locked. Ask a manager to unlock availability.');
    }
    for (const row of body.rows) {
      ensureValidShiftWindow(row.dayIndex, row.startMinutes, row.endMinutes);
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
      select: { payPeriodAnchor: true, payPeriodLengthDays: true, availabilityUnlocked: true, timezone: true },
    });
    return {
      anchor: venue?.payPeriodAnchor ?? DEFAULT_PAY_PERIOD_ANCHOR,
      lengthDays: venue?.payPeriodLengthDays ?? DEFAULT_PAY_PERIOD_LENGTH_DAYS,
      unlocked: venue?.availabilityUnlocked ?? false,
      timezone: venue?.timezone ?? null,
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
    const [venue, shifts, staff, config] = await Promise.all([
      this.prisma.venue.findUniqueOrThrow({ where: { id: scope!.venueId } }),
      this.prisma.scheduleShift.findMany({
        where: { venueId: scope!.venueId },
        include: { profile: true },
        orderBy: [{ dayIndex: 'asc' }, { startMinutes: 'asc' }],
      }),
      this.prisma.profile.findMany({ where: { venueId: scope!.venueId }, orderBy: { fullName: 'asc' } }),
      this.payPeriodConfig(scope!.venueId),
    ]);
    const today = todayInZone(config.timezone);
    const weekStarts = upcomingWeeks(today, weeksToCover(config.lengthDays));
    const availability = await this.prisma.availability.findMany({
      where: { venueId: scope!.venueId, weekStart: { in: weekStarts } },
      orderBy: [{ weekStart: 'asc' }, { dayIndex: 'asc' }, { startMinutes: 'asc' }],
    });
    const availabilityByProfile = new Map<string, typeof availability>();
    const selectedAvailabilityWeekByProfile = new Map<string, string>();
    for (const row of availability) {
      const selectedWeek = selectedAvailabilityWeekByProfile.get(row.profileId);
      if (selectedWeek && selectedWeek !== row.weekStart) continue;
      if (!selectedWeek) selectedAvailabilityWeekByProfile.set(row.profileId, row.weekStart);
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
      shifts: shifts.map((shift) => {
        const rows = shift.profileId ? availabilityByProfile.get(shift.profileId) : undefined;
        return this.mapManagerShift(shift, rows && rows.length > 0 ? !availabilityCovers(rows, shift) : false);
      }),
      staff: staff.map((member) => {
        const mins = weeklyMinutes.get(member.id) ?? 0;
        return {
          _id: member.id,
          fullName: member.fullName,
          role: member.role,
          jobTitle: member.jobTitle,
          weeklyHours: Math.round((mins / 60) * 10) / 10,
          overtime: mins > 40 * 60,
          availabilityWeekStart: selectedAvailabilityWeekByProfile.get(member.id) ?? null,
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
  @Get('labor-forecast')
  async getLaborForecast(@VenueScope() scope: Scope) {
    this.requireManager(scope);
    const venue = await this.prisma.venue.findUnique({
      where: { id: scope!.venueId },
      select: { timezone: true },
    });
    const tz = venue?.timezone ?? null;
    const now = new Date();
    const weekEnd = new Date(now);
    weekEnd.setDate(now.getDate() + 7);
    const [shifts, reservations, venueEvents] = await Promise.all([
      this.prisma.scheduleShift.findMany({ where: { venueId: scope!.venueId } }),
      this.prisma.reservation.findMany({
        where: {
          venueId: scope!.venueId,
          deletedAt: null,
          reservationTime: { gte: now, lt: weekEnd },
          status: { notIn: ['cancelled', 'no_show'] },
        },
        select: { reservationTime: true, partySize: true, isPrivateEvent: true },
      }),
      this.prisma.venueEvent.findMany({
        where: {
          venueId: scope!.venueId,
          startsAt: { gte: now, lt: weekEnd },
        },
        select: { startsAt: true, expectedGuests: true },
      }),
    ]);

    const scheduledByDay = new Map<number, { minutes: number; people: Set<string> }>();
    for (const shift of shifts) {
      const row = scheduledByDay.get(shift.dayIndex) ?? { minutes: 0, people: new Set<string>() };
      row.minutes += Math.max(0, shift.endMinutes - shift.startMinutes);
      if (shift.profileId) row.people.add(shift.profileId);
      scheduledByDay.set(shift.dayIndex, row);
    }

    const demandByDay = new Map<number, { covers: number; privateEvents: number }>();
    for (const reservation of reservations) {
      const dayIndex = zonedDayOfWeek(tz, reservation.reservationTime.getTime());
      const row = demandByDay.get(dayIndex) ?? { covers: 0, privateEvents: 0 };
      row.covers += reservation.partySize;
      if (reservation.isPrivateEvent) row.privateEvents += 1;
      demandByDay.set(dayIndex, row);
    }
    for (const event of venueEvents) {
      const dayIndex = zonedDayOfWeek(tz, event.startsAt.getTime());
      const row = demandByDay.get(dayIndex) ?? { covers: 0, privateEvents: 0 };
      row.covers += event.expectedGuests ?? 0;
      row.privateEvents += 1;
      demandByDay.set(dayIndex, row);
    }

    const days = Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(now);
      date.setDate(now.getDate() + offset);
      const dayIndex = zonedDayOfWeek(tz, date.getTime());
      const scheduled = scheduledByDay.get(dayIndex);
      const demand = demandByDay.get(dayIndex) ?? { covers: 0, privateEvents: 0 };
      const scheduledHours = Math.round(((scheduled?.minutes ?? 0) / 60) * 10) / 10;
      const suggestedHours = Math.max(0, Math.round((demand.covers / 8 + demand.privateEvents * 6) * 10) / 10);
      const gapHours = Math.round((suggestedHours - scheduledHours) * 10) / 10;
      return {
        dayIndex,
        dayLabel: dayLabel(dayIndex),
        covers: demand.covers,
        privateEvents: demand.privateEvents,
        scheduledPeople: scheduled?.people.size ?? 0,
        scheduledHours,
        suggestedHours,
        gapHours,
        status: gapHours > 4 ? 'under' : gapHours < -6 ? 'over' : 'balanced',
      };
    });

    const totalCovers = days.reduce((sum, day) => sum + day.covers, 0);
    const totalScheduledHours = Math.round(days.reduce((sum, day) => sum + day.scheduledHours, 0) * 10) / 10;
    const totalSuggestedHours = Math.round(days.reduce((sum, day) => sum + day.suggestedHours, 0) * 10) / 10;
    return {
      days,
      totals: {
        covers: totalCovers,
        scheduledHours: totalScheduledHours,
        suggestedHours: totalSuggestedHours,
        gapHours: Math.round((totalSuggestedHours - totalScheduledHours) * 10) / 10,
      },
    };
  }

  @RequireSubscription()
  @Post('shifts')
  async createShift(@VenueScope() scope: Scope, @Body() body: ShiftDto) {
    this.requireManager(scope);
    ensureValidShiftWindow(body.dayIndex, body.startMinutes, body.endMinutes);
    if (body.profileId) await this.assertVenueMember(scope!.venueId, body.profileId);
    const shift = await withSerializableRetry(this.prisma, async (tx) => {
      if (body.profileId) {
        await this.lockAssignmentKeys(tx, [{ venueId: scope!.venueId, profileId: body.profileId, dayIndex: body.dayIndex }]);
        await this.assertNoDoubleBookTx(tx, scope!.venueId, body.profileId, body.dayIndex, body.startMinutes, body.endMinutes);
      }
      const created = await tx.scheduleShift.create({
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
      await tx.venue.update({ where: { id: scope!.venueId }, data: { scheduleUpdatedAfterPublishAt: new Date() } });
      return created;
    });
    if (body.profileId) {
      await this.notifications.notifyProfile({
        venueId: scope!.venueId,
        profileId: body.profileId,
        kind: 'shift_assigned',
        title: 'New shift assigned',
        body: `${dayLabel(body.dayIndex)} ${minutesToTime(body.startMinutes)}-${minutesToTime(body.endMinutes)} · ${body.jobTitle}`,
      });
      void this.sendScheduleUpdateEmail(body.profileId, 'Added', undefined, {
        dayIndex: body.dayIndex,
        startMinutes: body.startMinutes,
        endMinutes: body.endMinutes,
        station: body.station,
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
    await withSerializableRetry(this.prisma, async (tx) => {
      if (shift.profileId) {
        await this.lockAssignmentKeys(tx, [{ venueId: scope!.venueId, profileId: shift.profileId, dayIndex: body.dayIndex }]);
        await this.assertNoDoubleBookTx(tx, scope!.venueId, shift.profileId, body.dayIndex, body.startMinutes, body.endMinutes, shift.id);
      }
      await tx.scheduleShift.update({
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
      await tx.venue.update({ where: { id: scope!.venueId }, data: { scheduleUpdatedAfterPublishAt: new Date() } });
    });
    if (shift.profileId) {
      void this.sendScheduleUpdateEmail(shift.profileId, 'Edited', {
        dayIndex: shift.dayIndex,
        startMinutes: shift.startMinutes,
        endMinutes: shift.endMinutes,
        station: shift.station,
      }, {
        dayIndex: body.dayIndex,
        startMinutes: body.startMinutes,
        endMinutes: body.endMinutes,
        station: body.station,
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
        void this.sendScheduleUpdateEmail(shift.profileId, 'Removed', {
          dayIndex: shift.dayIndex,
          startMinutes: shift.startMinutes,
          endMinutes: shift.endMinutes,
          station: shift.station,
        }, undefined);
      }
      return { ok: true };
    }
    await this.assertVenueMember(scope!.venueId, body.profileId);
    await withSerializableRetry(this.prisma, async (tx) => {
      const current = await tx.scheduleShift.findFirst({ where: { id: shift.id, venueId: scope!.venueId } });
      if (!current) throw new NotFoundException('Shift not found');
      await this.lockAssignmentKeys(tx, [{ venueId: scope!.venueId, profileId: body.profileId!, dayIndex: current.dayIndex }]);
      await this.assertNoDoubleBookTx(tx, scope!.venueId, body.profileId!, current.dayIndex, current.startMinutes, current.endMinutes, current.id);
      await tx.scheduleShift.update({ where: { id: current.id }, data: { profileId: body.profileId, status: 'scheduled' } });
      await tx.venue.update({ where: { id: scope!.venueId }, data: { scheduleUpdatedAfterPublishAt: new Date() } });
    });
    void this.sendScheduleUpdateEmail(body.profileId, 'Added', undefined, {
      dayIndex: shift.dayIndex,
      startMinutes: shift.startMinutes,
      endMinutes: shift.endMinutes,
      station: shift.station,
    });
    if (shift.profileId && shift.profileId !== body.profileId) {
      void this.sendScheduleUpdateEmail(shift.profileId, 'Removed', {
        dayIndex: shift.dayIndex,
        startMinutes: shift.startMinutes,
        endMinutes: shift.endMinutes,
        station: shift.station,
      }, undefined);
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
      void this.sendScheduleUpdateEmail(shift.profileId, 'Removed', {
        dayIndex: shift.dayIndex,
        startMinutes: shift.startMinutes,
        endMinutes: shift.endMinutes,
        station: shift.station,
      }, undefined);
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
          shiftId: shift.id,
          profileId: shift.profileId,
          name: shift.profile?.fullName ?? 'Teammate',
          memberName: shift.profile?.fullName ?? 'Teammate',
          jobTitle: shift.jobTitle,
          station: shift.station,
          dayIndex: shift.dayIndex,
          startMinutes: shift.startMinutes,
          endMinutes: shift.endMinutes,
          startTime: minutesToTime(shift.startMinutes),
          endTime: minutesToTime(shift.endMinutes),
          withMe: mine.some((myShift) =>
            myShift.dayIndex === shift.dayIndex &&
            myShift.startMinutes < shift.endMinutes &&
            myShift.endMinutes > shift.startMinutes,
          ),
        })),
    }));
    return {
      mine: mine.map((shift) => this.mapEmployeeShift(shift, true)),
      open: open.map((shift) => this.mapEmployeeShift(shift, false)),
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
    const venue = await this.prisma.venue.findUnique({
      where: { id: scope!.venueId },
      select: { timezone: true, name: true },
    });
    const tz = venue?.timezone ?? null;
    const today = todayInZone(tz);
    const sunday = weekStartFor(today);
    const saturday = addDays(sunday, 6);

    const formatDateMD = (dateStr: string) => {
      const [y, m, d] = dateStr.split('-');
      return `${m}/${d}`;
    };

    const formatDateMDY = (dateStr: string) => {
      const [y, m, d] = dateStr.split('-');
      return `${m}/${d}/${y}`;
    };

    const weekLabel = `${formatDateMD(sunday)} – ${formatDateMD(saturday)}`;
    const periodLabel = `${formatDateMDY(sunday)} – ${formatDateMDY(saturday)}`;

    const totalShifts = shifts.length;
    const staffScheduled = new Set(shifts.map((s) => s.profileId).filter(Boolean)).size;
    const openShifts = shifts.filter((s) => s.status === 'open').length;
    const pendingApprovals = await this.prisma.shiftSwap.count({
      where: { venueId: scope!.venueId, status: { in: ['proposed', 'accepted'] } },
    });

    // Email 1: Send to the publishing manager
    void this.email.sendToProfile(scope!.profileId, {
      subject: `Schedule Published — Your Team's Shifts Are Live`,
      text:
        `Hi ${scope!.fullName},\n\n` +
        `Your schedule for Week of ${weekLabel} has been successfully published. Your team has been notified and can view their shifts immediately in the Venue Wrangler app.\n\n` +
        `What Happens Next\n` +
        `Staff are notified via push notification the moment a schedule is published\n` +
        `Shifts are visible to each employee as soon as they open the app\n` +
        `Availability conflicts, if any, are flagged in your dashboard for review\n\n` +
        `Schedule Summary\n` +
        `Detail\tInfo\n` +
        `Schedule Period\t${periodLabel}\n` +
        `Total Shifts\t${totalShifts}\n` +
        `Staff Scheduled\t${staffScheduled}\n` +
        `Open Shifts\t${openShifts}\n` +
        `Pending Approvals\t${pendingApprovals}\n\n` +
        `Making Updates After Publishing\n` +
        `Edit a shift — Select the shift and tap Edit. Changes push to the employee instantly.\n` +
        `Add a shift — Tap an open slot and assign a team member or post as an open shift.\n` +
        `Remove a shift — Select the shift and tap Delete. The employee is notified automatically.\n` +
        `Handle swap requests — Swap requests appear in your Requests & Approvals queue.\n\n` +
        `Pro Tips\n` +
        `Publish schedules at least 72 hours in advance\n` +
        `Use open shifts to fill gaps without manual assignment\n` +
        `Check the Operations Dashboard for a real-time view of who's clocked in\n\n` +
        `Questions? support@venuewrangler.com\n\n` +
        `Let's wrangle. 🤘\n\n` +
        `— The Venue Wrangler Team`,
    });

    // Email 2: Send to all assigned staff members
    const assignedProfiles = await this.prisma.profile.findMany({
      where: {
        venueId: scope!.venueId,
        id: { in: shifts.map((s) => s.profileId).filter(Boolean) as string[] },
      },
    });

    for (const staff of assignedProfiles) {
      const staffShifts = shifts.filter((s) => s.profileId === staff.id);
      const shiftRows = staffShifts
        .map((s) => {
          const dayName = dayLabel(s.dayIndex);
          const dateMD = formatDateMD(addDays(sunday, s.dayIndex));
          const startTime = minutesToTime(s.startMinutes);
          const endTime = minutesToTime(s.endMinutes);
          const area = s.station || 'Floor';
          return `${dayName}\t${dateMD}\t${startTime}\t${endTime}\t${area}`;
        })
        .join('\n');

      void this.email.sendToProfile(staff.id, {
        subject: `Your Schedule Is Live for Week of ${weekLabel}`,
        text:
          `Hi ${staff.fullName},\n\n` +
          `Your manager just published the schedule for Week of ${weekLabel}. Your shifts are ready to view now in the Venue Wrangler app.\n\n` +
          `Your Upcoming Shifts\n` +
          `Day\tDate\tStart\tEnd\tLocation/Section\n` +
          `${shiftRows}\n\n` +
          `Log in to the app to see your full schedule.\n\n` +
          `Need to Make a Change?\n` +
          `Request time off — Submit a request and your manager is notified right away\n` +
          `Swap a shift — Request a swap and it goes to your manager for approval\n` +
          `Pick up an open shift — Check the Open Shifts board for extra hours\n\n` +
          `Reminders\n` +
          `Clock in using the app when your shift starts\n` +
          `You'll always be notified if your schedule changes\n` +
          `Reach out to your manager through the app for any conflicts\n\n` +
          `Questions? support@venuewrangler.com\n\n` +
          `See you on the floor. 👊\n\n` +
          `— The Venue Wrangler Team`,
      });
    }
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
    if (shifts.length === 0) throw new BadRequestException('Create at least one shift before saving a template.');
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
          notes: shift.notes,
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
    const slots = this.parseTemplateSlots(template.shifts);
    if (slots.length === 0) throw new BadRequestException('This template has no shifts to apply.');
    const creates = slots.map((row) => {
      return this.prisma.scheduleShift.create({
        data: {
          venueId: scope!.venueId,
          dayIndex: row.dayIndex,
          startMinutes: row.startMinutes,
          endMinutes: row.endMinutes,
          jobTitle: row.jobTitle,
          station: row.station,
          notes: row.notes?.trim() || null,
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
  async previewAutoSchedule(@VenueScope() scope: Scope, @Query('weekStartDate') weekStartDate?: string) {
    this.requireManager(scope);
    const availabilityWeekStart = await this.resolveAvailabilityWeekStart(scope!.venueId, weekStartDate);
    const [shifts, staff, availability] = await Promise.all([
      this.prisma.scheduleShift.findMany({
        where: { venueId: scope!.venueId },
        include: { profile: true },
        orderBy: [{ dayIndex: 'asc' }, { startMinutes: 'asc' }],
      }),
      this.prisma.profile.findMany({ where: { venueId: scope!.venueId }, orderBy: { fullName: 'asc' } }),
      this.prisma.availability.findMany({
        where: { venueId: scope!.venueId, weekStart: availabilityWeekStart },
        orderBy: [{ profileId: 'asc' }, { dayIndex: 'asc' }, { startMinutes: 'asc' }],
      }),
    ]);
    const availabilityByProfile = this.groupAvailabilityByProfile(availability);
    const openShifts = shifts.filter((shift) => shift.status === 'open' && !shift.profileId);
    const assignments = new Map<string, number>();
    const proposals = openShifts.map((shift) => {
      let sawRoleMatch = false;
      let sawAvailable = false;
      let sawFree = false;
      const candidate = staff.find((member) => {
        const assignedMinutes = assignments.get(member.id) ?? 0;
        const roleMatch =
          member.jobTitle.toLowerCase().includes(shift.jobTitle.toLowerCase()) ||
          shift.jobTitle.toLowerCase().includes(member.jobTitle.toLowerCase()) ||
          member.role === 'staff' ||
          member.role === 'server';
        if (!roleMatch) return false;
        sawRoleMatch = true;
        const hasAvailability = availabilityCovers(availabilityByProfile.get(member.id), shift);
        if (!hasAvailability) return false;
        sawAvailable = true;
        const overlaps = shifts.some((other) =>
          other.profileId === member.id &&
          other.dayIndex === shift.dayIndex &&
          other.startMinutes < shift.endMinutes &&
          other.endMinutes > shift.startMinutes,
        );
        if (overlaps) return false;
        sawFree = true;
        return assignedMinutes < 40 * 60;
      });
      if (candidate) assignments.set(candidate.id, (assignments.get(candidate.id) ?? 0) + Math.max(0, shift.endMinutes - shift.startMinutes));
      return {
        shiftId: shift.id,
        dayLabel: dayLabel(shift.dayIndex),
        startTime: minutesToTime(shift.startMinutes),
        endTime: minutesToTime(shift.endMinutes),
        jobTitle: shift.jobTitle,
        profileId: candidate?.id ?? null,
        reason: candidate ? 'assigned' : !sawRoleMatch ? 'no_role_match' : !sawAvailable ? 'no_availability' : !sawFree ? 'all_double_booked' : 'labor_cap',
      };
    });
    const filled = proposals.filter((proposal) => proposal.profileId).length;
    return {
      openCount: openShifts.length,
      filled,
      unfilled: openShifts.length - filled,
      weekStart: availabilityWeekStart,
      proposals,
    };
  }

  @RequireSubscription()
  @Post('auto-schedule/apply')
  async applyAutoSchedule(@VenueScope() scope: Scope, @Body() body: ApplyAutoScheduleDto) {
    this.requireManager(scope);
    const availabilityWeekStart = await this.resolveAvailabilityWeekStart(scope!.venueId, body.weekStartDate);
    const availability = await this.prisma.availability.findMany({
      where: { venueId: scope!.venueId, weekStart: availabilityWeekStart },
      orderBy: [{ profileId: 'asc' }, { dayIndex: 'asc' }, { startMinutes: 'asc' }],
    });
    const availabilityByProfile = this.groupAvailabilityByProfile(availability);
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
      if (!availabilityCovers(availabilityByProfile.get(assignment.profileId), shift)) {
        skipped += 1;
        continue;
      }
      try {
        await withSerializableRetry(this.prisma, async (tx) => {
          const current = await tx.scheduleShift.findFirst({ where: { id: shift.id, venueId: scope!.venueId } });
          if (!current || current.profileId || current.status !== 'open') throw new BadRequestException('Shift is no longer open.');
          await this.lockAssignmentKeys(tx, [{ venueId: scope!.venueId, profileId: assignment.profileId, dayIndex: current.dayIndex }]);
          await this.assertNoDoubleBookTx(tx, scope!.venueId, assignment.profileId, current.dayIndex, current.startMinutes, current.endMinutes, current.id);
          await tx.scheduleShift.update({
            where: { id: current.id },
            data: { profileId: assignment.profileId, status: 'scheduled' },
          });
        });
      } catch {
        skipped += 1;
        continue;
      }
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
      void this.sendManagerSwapApprovalEmail(scope.venueId, swap.id);
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
      await withSerializableRetry(this.prisma, async (tx) => {
        const requesterShift = await tx.scheduleShift.findFirst({ where: { id: swap.requesterShiftId, venueId: scope!.venueId } });
        const targetShift = swap.targetShiftId ? await tx.scheduleShift.findFirst({ where: { id: swap.targetShiftId, venueId: scope!.venueId } }) : null;
        if (!requesterShift || (swap.targetShiftId && !targetShift)) throw new NotFoundException('Shift not found');
        await this.lockAssignmentKeys(tx, [
          { venueId: scope!.venueId, profileId: swap.targetProfileId, dayIndex: requesterShift.dayIndex },
          ...(targetShift ? [{ venueId: scope!.venueId, profileId: swap.requesterProfileId, dayIndex: targetShift.dayIndex }] : []),
        ]);
        await this.assertNoDoubleBookTx(
          tx,
          scope!.venueId,
          swap.targetProfileId,
          requesterShift.dayIndex,
          requesterShift.startMinutes,
          requesterShift.endMinutes,
          requesterShift.id,
          targetShift?.id,
        );
        if (targetShift) {
          await this.assertNoDoubleBookTx(
            tx,
            scope!.venueId,
            swap.requesterProfileId,
            targetShift.dayIndex,
            targetShift.startMinutes,
            targetShift.endMinutes,
            targetShift.id,
            requesterShift.id,
          );
        }
        await tx.scheduleShift.update({ where: { id: requesterShift.id }, data: { profileId: swap.targetProfileId, status: 'scheduled' } });
        if (targetShift) {
          await tx.scheduleShift.update({ where: { id: targetShift.id }, data: { profileId: swap.requesterProfileId, status: 'scheduled' } });
        }
        const reviewed = await tx.shiftSwap.updateMany({ where: { id: swap.id, status: { in: ['accepted', 'proposed'] } }, data: { status: 'approved' } });
        if (reviewed.count === 0) throw new BadRequestException('Swap is no longer pending');
        await tx.venue.update({ where: { id: scope!.venueId }, data: { scheduleUpdatedAfterPublishAt: new Date() } });
      });
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
    void this.sendStaffSwapReviewedEmail(scope!.venueId, swap.id, body.approve);
    await this.notifications.notifyProfile({
      venueId: scope!.venueId,
      profileId: swap.targetProfileId,
      kind: 'swap_reviewed',
      title: `Swap ${body.approve ? 'approved' : 'denied'}`,
      body: `A shift swap was ${body.approve ? 'approved' : 'denied'}.`,
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
    await this.assertNoDoubleBookTx(this.prisma, venueId, profileId, dayIndex, startMinutes, endMinutes, ...excludeShiftIds);
  }

  private async assertNoDoubleBookTx(
    tx: Prisma.TransactionClient | PrismaService,
    venueId: string,
    profileId: string,
    dayIndex: number,
    startMinutes: number,
    endMinutes: number,
    ...excludeShiftIds: Array<string | undefined>
  ) {
    const excluded = excludeShiftIds.filter((id): id is string => Boolean(id));
    const overlapping = await tx.scheduleShift.findFirst({
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

  private async lockAssignmentKeys(
    tx: Prisma.TransactionClient,
    keys: Array<{ venueId: string; profileId: string; dayIndex: number }>,
  ) {
    const uniqueKeys = Array.from(
      new Set(keys.map((key) => `schedule:${key.venueId}:${key.profileId}:${key.dayIndex}`)),
    ).sort();
    for (const key of uniqueKeys) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    }
  }

  private markScheduleEdited(venueId: string) {
    return this.prisma.venue.update({
      where: { id: venueId },
      data: { scheduleUpdatedAfterPublishAt: new Date() },
    });
  }

  private resolveAvailabilityWeekStart(venueId: string, weekStartDate?: string) {
    if (weekStartDate) {
      if (!isIsoDate(weekStartDate)) throw new BadRequestException('weekStartDate must be a YYYY-MM-DD date');
      return Promise.resolve(weekStartFor(weekStartDate));
    }
    return this.payPeriodConfig(venueId).then((config) => weekStartFor(todayInZone(config.timezone)));
  }

  private groupAvailabilityByProfile(rows: Availability[]) {
    const byProfile = new Map<string, Availability[]>();
    for (const row of rows) {
      const profileRows = byProfile.get(row.profileId) ?? [];
      profileRows.push(row);
      byProfile.set(row.profileId, profileRows);
    }
    return byProfile;
  }

  private mapManagerShift(shift: ShiftWithProfile, conflict = false) {
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
      conflict,
    };
  }

  private mapEmployeeShift(shift: ShiftWithProfile, mine: boolean) {
    return {
      _id: shift.id,
      dayIndex: shift.dayIndex,
      dayLabel: dayLabel(shift.dayIndex),
      startMinutes: shift.startMinutes,
      endMinutes: shift.endMinutes,
      startTime: minutesToTime(shift.startMinutes),
      endTime: minutesToTime(shift.endMinutes),
      memberId: shift.profileId,
      memberName: shift.profile?.fullName ?? null,
      jobTitle: shift.jobTitle,
      station: shift.station,
      status: shift.status,
      notes: shift.notes ?? undefined,
      mine,
      conflict: false,
    };
  }

  private parseTemplateSlots(value: Prisma.JsonValue): TemplateShiftSlot[] {
    if (!Array.isArray(value)) return [];
    return value.map((slot) => {
      const parsed = plainToInstance(TemplateShiftDto, slot);
      const errors = validateSync(parsed, { whitelist: true, forbidNonWhitelisted: true });
      if (errors.length > 0) {
        throw new BadRequestException('Template contains an invalid shift.');
      }
      ensureValidShiftWindow(parsed.dayIndex, parsed.startMinutes, parsed.endMinutes);
      return parsed as TemplateShiftSlot;
    });
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
  private async sendScheduleUpdateEmail(
    profileId: string,
    changeType: 'Added' | 'Edited' | 'Removed',
    before?: { dayIndex: number; startMinutes: number; endMinutes: number; station: string },
    after?: { dayIndex: number; startMinutes: number; endMinutes: number; station: string },
  ) {
    const profile = await this.prisma.profile.findUnique({ where: { id: profileId } });
    if (!profile) return;

    const venue = await this.prisma.venue.findUnique({
      where: { id: profile.venueId! },
      select: { timezone: true },
    });
    const tz = venue?.timezone ?? null;
    const today = todayInZone(tz);
    const sunday = weekStartFor(today);

    const formatDateMDY = (dayIdx: number) => {
      const dateStr = addDays(sunday, dayIdx);
      const [y, m, d] = dateStr.split('-');
      return `${m}/${d}/${y}`;
    };

    const formatTime = (minutes: number) => minutesToTime(minutes);

    const beforeDate = before ? formatDateMDY(before.dayIndex) : '—';
    const beforeTime = before ? `${formatTime(before.startMinutes)} – ${formatTime(before.endMinutes)}` : '—';
    const beforeArea = before ? (before.station || 'Floor') : '—';

    const afterDate = after ? formatDateMDY(after.dayIndex) : '—';
    const afterTime = after ? `${formatTime(after.startMinutes)} – ${formatTime(after.endMinutes)}` : '—';
    const afterArea = after ? (after.station || 'Floor') : '—';

    void this.email.sendToProfile(profileId, {
      subject: 'Schedule Update — A Change Has Been Made to Your Shift',
      text:
        `Hi ${profile.fullName},\n\n` +
        `Your manager has made an update to your schedule. Please review the change below.\n\n` +
        `What Changed\n` +
        `Detail\tBefore\tAfter\n` +
        `Date\t${beforeDate}\t${afterDate}\n` +
        `Shift Time\t${beforeTime}\t${afterTime}\n` +
        `Location/Section\t${beforeArea}\t${afterArea}\n` +
        `Change Type\t—\t${changeType}\n\n` +
        `What to Do\n` +
        `No action required unless you have a conflict\n` +
        `Reach out to your manager through the app to discuss the change\n` +
        `Submit a swap or time-off request if needed\n\n` +
        `Questions? support@venuewrangler.com\n\n` +
        `— The Venue Wrangler Team`,
    });
  }

  private async sendManagerSwapApprovalEmail(venueId: string, swapId: string) {
    const swap = await this.prisma.shiftSwap.findUnique({ where: { id: swapId } });
    if (!swap) return;

    const [requester, target, reqShift, tarShift] = await Promise.all([
      this.prisma.profile.findUnique({ where: { id: swap.requesterProfileId } }),
      this.prisma.profile.findUnique({ where: { id: swap.targetProfileId } }),
      this.prisma.scheduleShift.findUnique({ where: { id: swap.requesterShiftId } }),
      swap.targetShiftId ? this.prisma.scheduleShift.findUnique({ where: { id: swap.targetShiftId } }) : Promise.resolve(null),
    ]);

    if (!requester || !target || !reqShift) return;

    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: { timezone: true, name: true },
    });
    const tz = venue?.timezone ?? null;
    const today = todayInZone(tz);
    const sunday = weekStartFor(today);

    const formatDateMDY = (dayIdx: number) => {
      const dateStr = addDays(sunday, dayIdx);
      const [y, m, d] = dateStr.split('-');
      return `${m}/${d}/${y}`;
    };

    const formatTime = (minutes: number) => minutesToTime(minutes);

    const reqDate = formatDateMDY(reqShift.dayIndex);
    const reqTime = `${formatTime(reqShift.startMinutes)} – ${formatTime(reqShift.endMinutes)}`;

    const tarDate = tarShift ? formatDateMDY(tarShift.dayIndex) : '—';
    const tarTime = tarShift ? `${formatTime(tarShift.startMinutes)} – ${formatTime(tarShift.endMinutes)}` : '—';

    // Format submitted timestamp (createdAt)
    const submittedStr = swap.createdAt.toLocaleString('en-US', {
      timeZone: tz || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    // Send to all managers at the venue
    const managers = await this.prisma.profile.findMany({
      where: {
        venueId,
        role: { in: ['admin', 'owner', 'manager'] },
      },
    });

    for (const manager of managers) {
      void this.email.send({
        to: manager.email,
        subject: 'Shift Swap Request — Action Required',
        text:
          `Hi ${manager.fullName},\n\n` +
          `${requester.fullName} has submitted a shift swap request. Please review and take action in the Venue Wrangler app.\n\n` +
          `Swap Request Details\n` +
          `Detail\tRequestor\tSwap Partner\n` +
          `Employee\t${requester.fullName}\t${target.fullName}\n` +
          `Date\t${reqDate}\t${tarDate}\n` +
          `Shift Time\t${reqTime}\t${tarTime}\n` +
          `Submitted\t${submittedStr}\t—\n\n` +
          `How to Respond\n` +
          `1. Open the Venue Wrangler app\n` +
          `2. Go to Requests & Approvals\n` +
          `3. Select the swap request\n` +
          `4. Tap Approve or Deny — both employees are notified instantly\n\n` +
          `Pending requests can also be managed from your Operations Dashboard.\n\n` +
          `Questions? support@venuewrangler.com\n\n` +
          `— The Venue Wrangler Team`,
      });
    }
  }

  private async sendStaffSwapReviewedEmail(venueId: string, swapId: string, approve: boolean) {
    const swap = await this.prisma.shiftSwap.findUnique({ where: { id: swapId } });
    if (!swap) return;

    const [requester, target, reqShift, tarShift] = await Promise.all([
      this.prisma.profile.findUnique({ where: { id: swap.requesterProfileId } }),
      this.prisma.profile.findUnique({ where: { id: swap.targetProfileId } }),
      this.prisma.scheduleShift.findUnique({ where: { id: swap.requesterShiftId } }),
      swap.targetShiftId ? this.prisma.scheduleShift.findUnique({ where: { id: swap.targetShiftId } }) : Promise.resolve(null),
    ]);

    if (!requester || !target || !reqShift) return;

    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: { timezone: true },
    });
    const tz = venue?.timezone ?? null;
    const today = todayInZone(tz);
    const sunday = weekStartFor(today);

    const formatDateMDY = (dayIdx: number) => {
      const dateStr = addDays(sunday, dayIdx);
      const [y, m, d] = dateStr.split('-');
      return `${m}/${d}/${y}`;
    };

    const formatTime = (minutes: number) => minutesToTime(minutes);

    const reqDate = formatDateMDY(reqShift.dayIndex);
    const reqTime = `${formatTime(reqShift.startMinutes)} – ${formatTime(reqShift.endMinutes)}`;

    const tarDate = tarShift ? formatDateMDY(tarShift.dayIndex) : '—';
    const tarTime = tarShift ? `${formatTime(tarShift.startMinutes)} – ${formatTime(tarShift.endMinutes)}` : '—';

    const statusText = approve ? 'Approved' : 'Denied';

    const sendEmail = (recipient: typeof requester, coworker: typeof target, isRequester: boolean) => {
      void this.email.send({
        to: recipient.email,
        subject: `Your Shift Swap Request Has Been ${statusText}`,
        text:
          `Hi ${recipient.fullName},\n\n` +
          `Your shift swap request has been ${statusText} by your manager. Here are the details:\n\n` +
          `Swap Details\n` +
          `Detail\tYour Shift\tCoworker's Shift\n` +
          `Employee\t${recipient.fullName}\t${coworker.fullName}\n` +
          `Date\t${isRequester ? reqDate : tarDate}\t${isRequester ? tarDate : reqDate}\n` +
          `Shift Time\t${isRequester ? reqTime : tarTime}\t${isRequester ? tarTime : reqTime}\n` +
          `Status\t${statusText}\t${statusText}\n\n` +
          (approve
            ? `If Approved\n` +
              `Your schedule has been updated automatically\n` +
              `Both you and your coworker will see the updated shifts in the app\n` +
              `Make sure to clock in for your new shift on time\n\n`
            : `If Denied\n` +
              `Your original shift remains on your schedule\n` +
              `Reach out to your manager through the app if you have questions or need further assistance\n\n`) +
          `Questions? support@venuewrangler.com\n\n` +
          `— The Venue Wrangler Team`,
      });
    };

    // Send to both employees
    sendEmail(requester, target, true);
    sendEmail(target, requester, false);
  }
}
