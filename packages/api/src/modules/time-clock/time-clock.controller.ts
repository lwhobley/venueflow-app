import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
} from '@nestjs/common';
import { IsBoolean, IsNumber, IsOptional, IsString, IsIn, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../auth/auth.guard';
import { canManageVenue, isAdminRole } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { assertFixNotReplayed, assertWithinGeofence, type PriorFix } from '../../common/geofence';
import { closeOpenBreaks, parseTimeBreaks, unpaidBreakMs } from '../../common/break-duration';
import { addDays, todayInZone, weekStartFor } from '../../common/pay-period';
import { mapClockEntry, minutesToTime } from '../../common/mappers';
import { isWithinShiftWindow, normalizedShiftEnd, shiftHasEnded, zonedDateBounds, zonedDayOfWeek, zonedMinutesOfDay, zonedDayBounds } from '../../common/venue-time';
import { PrismaService } from '../../prisma/prisma.service';
import { AttestationService } from '../attestation/attestation.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { endBreakForProfile, startBreakForProfile } from './break-transitions';

type Scope = VenueScopedRequest['venueScope'];

/**
 * The exact fields the device signs. Only the location values are included:
 * they are the ones the server acts on and the ones an attacker would forge.
 * Client and server must build this identically (see AttestationService
 * canonicalPayload, which sorts keys).
 */
function punchPayload(body: ClockPunchDto) {
  return { lat: body.lat, lng: body.lng, accuracy: body.accuracy, mocked: body.mocked };
}

class PunchAttestationDto {
  @IsString() @MinLength(1) @MaxLength(256) keyId!: string;
  @IsString() @MinLength(1) @MaxLength(20_000) assertion!: string;
  @IsString() @MinLength(1) @MaxLength(256) challenge!: string;
}

class ClockPunchDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @IsNumber()
  @Min(0)
  accuracy!: number;

  @IsBoolean()
  mocked!: boolean;

  /**
   * App Attest assertion over this punch payload. Optional while
   * ATTESTATION_ENFORCED is false so already-installed builds keep working
   * during the staged rollout; once enforced, a punch without it is rejected.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => PunchAttestationDto)
  attestation?: PunchAttestationDto;
}

class BreakStartDto {
  @IsString()
  @IsIn(['paid', 'unpaid'])
  type!: 'paid' | 'unpaid';
}

@Controller('v1/time-clock')
export class TimeClockController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attestation: AttestationService,
  ) {}

  @RequireSubscription()
  @Get('board')
  async getClockBoard(@VenueScope() scope: Scope) {
    if (!scope) return null;
    const managerView = canManageVenue(scope.role, scope.allAccess);
    const venue = await this.prisma.venue.findUnique({ where: { id: scope.venueId } });
    if (!venue) return null;

    // The board only surfaces open entries and alerts derived from them, so we
    // never need the venue's full (unbounded) time-entry history.
    const entries = await this.prisma.timeEntry.findMany({
      where: { venueId: venue.id, isOpen: true },
      include: { profile: true },
    });

    const myRawEntry = entries.find((entry) => entry.isOpen && entry.profileId === scope.profileId && entry.profile);
    const myOpenEntry = myRawEntry ? mapClockEntry(myRawEntry, myRawEntry.profile!, venue) : null;
    const activeClockEntries = managerView
      ? entries.flatMap((entry) => (entry.isOpen && entry.profile ? [mapClockEntry(entry, entry.profile, venue, { includeLocation: false })] : []))
      : myOpenEntry
        ? [myOpenEntry]
        : [];

    const managerAlerts: Array<{
      kind: 'late_clock_in' | 'missed_clock_out';
      severity: 'warning' | 'danger';
      profileId: string;
      memberName: string;
      detail: string;
    }> = [];

    if (canManageVenue(scope.role, scope.allAccess)) {
      const now = Date.now();
      const tz = venue.timezone ?? null;
      const today = zonedDayOfWeek(tz, now);
      const minutesNow = zonedMinutesOfDay(tz, now);
      const todayDate = todayInZone(tz);
      const weekStart = weekStartFor(todayDate);
      const yesterdayDate = addDays(todayDate, -1);
      const yesterdayWeekStart = weekStartFor(yesterdayDate);
      const yesterday = (today + 6) % 7;
      const openByProfile = new Set(
        entries.filter((entry) => entry.isOpen).map((entry) => entry.profileId),
      );
      const shifts = await this.prisma.scheduleShift.findMany({
        where: {
          venueId: venue.id,
          OR: [
            { weekStart, dayIndex: today },
            { weekStart: yesterdayWeekStart, dayIndex: yesterday },
          ],
        },
        include: { profile: true },
      });
      for (const shift of shifts) {
        const isToday = shift.weekStart === weekStart && shift.dayIndex === today;
        const isOvernightYesterday = shift.weekStart === yesterdayWeekStart
          && shift.dayIndex === yesterday
          && normalizedShiftEnd(shift.startMinutes, shift.endMinutes) > 1440;
        if ((!isToday && !isOvernightYesterday) || !shift.profileId || shift.status === 'open') continue;
        if (
          isWithinShiftWindow(minutesNow, shift.startMinutes + 15, shift.endMinutes) &&
          !openByProfile.has(shift.profileId) &&
          shift.profile
        ) {
          managerAlerts.push({
            kind: 'late_clock_in',
            severity: 'warning',
            profileId: shift.profile.id,
            memberName: shift.profile.fullName,
            detail: `${shift.jobTitle} was scheduled at ${minutesToTime(shift.startMinutes)} and is not clocked in.`,
          });
        }
      }
      for (const entry of entries) {
        if (!entry.isOpen || now - entry.clockInAt.getTime() < 10 * 60 * 60 * 1000) continue;
        if (entry.profile) {
          managerAlerts.push({
            kind: 'missed_clock_out',
            severity: 'danger',
            profileId: entry.profile.id,
            memberName: entry.profile.fullName,
            detail: `Clocked in since ${entry.clockInAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz || 'UTC' })}.`,
          });
        }
      }
    }

    return {
      venue: {
        _id: venue.id,
        name: venue.name,
        latitude: venue.latitude,
        longitude: venue.longitude,
        geofenceRadiusM: venue.geofenceRadiusM,
        geofence_radius_m: venue.geofenceRadiusM,
        timezone: venue.timezone ?? null,
        subscriptionStatus: venue.subscriptionStatus ?? null,
        subscriptionPlatform: venue.subscriptionPlatform ?? null,
      },
      activeClockEntries,
      employeeEntry: myOpenEntry,
      managerAlerts: managerAlerts.slice(0, 8),
    };
  }

  @RequireSubscription()
  @Get('me')
  async getMyTimeClock(@CurrentUser() user: AuthUser, @VenueScope() scope: Scope) {
    const venueId = scope?.venueId ?? user.venueId;
    const profile = await this.prisma.profile.findFirst({
      where: { userId: user.sub, ...(venueId ? { venueId } : {}) },
      include: { venue: { select: { timezone: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (!profile) return null;

    // Only today's punches and the last week of hours are reported, so bound
    // the query to the last 8 days (plus any still-open entry) instead of the
    // profile's entire history.
    const windowStart = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const all = await this.prisma.timeEntry.findMany({
      where: { profileId: profile.id, OR: [{ isOpen: true }, { clockInAt: { gte: windowStart } }] },
    });
    const open = all.filter((entry) => entry.isOpen);
    const closed = all.filter((entry) => !entry.isOpen);

    const tz = profile.venue?.timezone ?? null;
    const startOfToday = zonedDayBounds(tz, 0).start;
    const now = Date.now();
    const punches: { type: 'in' | 'out'; at: number }[] = [];
    for (const entry of all) {
      const inAt = entry.clockInAt.getTime();
      if (inAt >= startOfToday) punches.push({ type: 'in', at: inAt });
      const outAt = entry.clockOutAt?.getTime();
      if (outAt && outAt >= startOfToday) punches.push({ type: 'out', at: outAt });
    }
    punches.sort((a, b) => a.at - b.at);

    const weekStartMs = zonedDateBounds(tz, weekStartFor(todayInZone(tz))).start;
    const regularHours = all.reduce((sum, entry) => {
      const outAt = entry.clockOutAt?.getTime() ?? (entry.isOpen ? now : null);
      if (!outAt || outAt < weekStartMs) return sum;
      const startAt = Math.max(entry.clockInAt.getTime(), weekStartMs);
      let durationMs = outAt - startAt;
      const breaks = parseTimeBreaks(entry.breaks);
      for (const b of breaks) {
        if (b.type === 'unpaid' && b.startAt && b.endAt) {
          durationMs -= unpaidBreakMs(Math.max(b.startAt, weekStartMs), b.endAt);
        }
      }
      return sum + Math.max(0, durationMs) / 3600000;
    }, 0);
    const round1 = (n: number) => Math.round(n * 10) / 10;

    return {
      isClockedIn: open.length > 0,
      openSince: open[0]?.clockInAt.getTime() ?? null,
      regularHours: round1(regularHours),
      sickHours: profile.sickHoursAccrued,
      ptoHours: profile.ptoHoursAccrued,
      totalHours: round1(regularHours),
      punches,
    };
  }

  /**
   * Coordinates from this profile's most recent punch on an *earlier* day.
   * Used to catch a replayed (hardcoded) GPS fix — see assertFixNotReplayed.
   * Same-day punches are excluded because a clock-out shortly after a clock-in
   * can legitimately reuse the OS's cached fix and repeat exactly.
   */
  private async priorDayFix(profileId: string, timezone: string | null | undefined): Promise<PriorFix | null> {
    const startOfToday = zonedDayBounds(timezone, 0).start;
    const previous = await this.prisma.timeEntry.findFirst({
      where: { profileId, clockInAt: { lt: new Date(startOfToday) } },
      orderBy: { clockInAt: 'desc' },
      select: { clockInLat: true, clockInLng: true },
    });
    if (!previous) return null;
    return { lat: previous.clockInLat, lng: previous.clockInLng };
  }

  @RequireSubscription()
  @Post('clock-in')
  async clockIn(@CurrentUser() user: AuthUser, @VenueScope() scope: Scope, @Body() body: ClockPunchDto) {
    if (!scope) throw new BadRequestException('Profile is not initialized');
    const venue = await this.prisma.venue.findUnique({ where: { id: scope.venueId } });
    if (!venue) throw new BadRequestException('Assigned venue not found');
    // Attestation first: the geofence checks below operate entirely on
    // client-supplied coordinates, so they only mean anything once we know the
    // request came from a genuine, unmodified build on real Apple hardware.
    await this.attestation.verifyRequest(user.sub, punchPayload(body), body.attestation);
    assertWithinGeofence(body.lat, body.lng, body.accuracy, body.mocked, venue);
    assertFixNotReplayed(body.lat, body.lng, await this.priorDayFix(scope.profileId, venue.timezone));

    const active = await this.prisma.timeEntry.findFirst({
      where: { profileId: scope.profileId, isOpen: true },
    });
    if (active) throw new BadRequestException('Already clocked in');

    const profile = await this.prisma.profile.findUniqueOrThrow({ where: { id: scope.profileId } });

    if (!canManageVenue(scope.role, scope.allAccess)) {
      const nowMs = Date.now();
      const today = zonedDayOfWeek(venue.timezone, nowMs);
      const minutesNow = zonedMinutesOfDay(venue.timezone, nowMs);
      const todayDate = todayInZone(venue.timezone);
      const weekStart = weekStartFor(todayDate);
      const yesterdayDate = addDays(todayDate, -1);
      const yesterdayWeekStart = weekStartFor(yesterdayDate);
      const yesterday = (today + 6) % 7;
      const shifts = (await this.prisma.scheduleShift.findMany({
        where: {
          venueId: venue.id,
          profileId: profile.id,
          status: { in: ['scheduled', 'covered'] },
          OR: [
            { weekStart, dayIndex: today },
            { weekStart: yesterdayWeekStart, dayIndex: yesterday },
          ],
        },
        orderBy: { startMinutes: 'asc' },
      })).filter((shift) => (
        (shift.weekStart === weekStart && shift.dayIndex === today)
        || (shift.weekStart === yesterdayWeekStart && shift.dayIndex === yesterday && normalizedShiftEnd(shift.startMinutes, shift.endMinutes) > 1440)
      ));
      if (shifts.length > 0) {
        const earlyWindow = venue.earlyClockInWindowMin ?? 10;
        const inWindow = shifts.some((shift) =>
          isWithinShiftWindow(minutesNow, shift.startMinutes, shift.endMinutes, earlyWindow),
        );
        const allEnded = shifts.every((shift) => shiftHasEnded(minutesNow, shift.startMinutes, shift.endMinutes));
        if (!inWindow && !allEnded) {
          const next = shifts.find((shift) => minutesNow < shift.startMinutes) ?? shifts[0];
          throw new BadRequestException(
            `Too early to clock in. Your shift starts at ${minutesToTime(next.startMinutes)}. You can clock in starting ${earlyWindow} minutes prior.`
          );
        }
      }
    }

    try {
      const entry = await this.prisma.timeEntry.create({
        data: {
          profileId: scope.profileId,
          venueId: venue.id,
          clockInAt: new Date(),
          clockInLat: body.lat,
          clockInLng: body.lng,
          clockInAccuracyM: body.accuracy,
          clockInMocked: body.mocked,
          isOpen: true,
        },
      });
      return mapClockEntry(entry, profile, venue);
    } catch (error: any) {
      // Partial unique index (one open entry per profile) — a concurrent
      // double-tap loses the race here instead of creating a second open entry.
      if (error?.code === 'P2002') throw new BadRequestException('Already clocked in');
      throw error;
    }
  }

  @RequireSubscription()
  @Post('clock-out')
  async clockOut(@CurrentUser() user: AuthUser, @VenueScope() scope: Scope, @Body() body: ClockPunchDto) {
    if (!scope) throw new BadRequestException('Profile is not initialized');
    const venue = await this.prisma.venue.findUnique({ where: { id: scope.venueId } });
    if (!venue) throw new BadRequestException('Assigned venue not found');
    await this.attestation.verifyRequest(user.sub, punchPayload(body), body.attestation);
    assertWithinGeofence(body.lat, body.lng, body.accuracy, body.mocked, venue);
    assertFixNotReplayed(body.lat, body.lng, await this.priorDayFix(scope.profileId, venue.timezone));

    const active = await this.prisma.timeEntry.findFirst({
      where: { profileId: scope.profileId, isOpen: true },
    });
    if (!active) throw new BadRequestException('No active clock-in found');

    const profile = await this.prisma.profile.findUniqueOrThrow({ where: { id: scope.profileId } });
    const clockOutAt = new Date();
    const count = await this.prisma.timeEntry.updateMany({
      where: { id: active.id, isOpen: true, updatedAt: active.updatedAt },
      data: {
        clockOutAt,
        clockOutLat: body.lat,
        clockOutLng: body.lng,
        clockOutAccuracyM: body.accuracy,
        clockOutMocked: body.mocked,
        isOpen: false,
        breaks: closeOpenBreaks(active.breaks, clockOutAt.getTime()),
      },
    });
    if (count.count === 0) throw new BadRequestException('Clock-out state changed. Refresh and try again.');
    const entry = await this.prisma.timeEntry.findUniqueOrThrow({ where: { id: active.id } });
    return mapClockEntry(entry, profile, venue);
  }

  @RequireSubscription()
  @Post('break-start')
  async startBreak(@VenueScope() scope: Scope, @Body() body: BreakStartDto) {
    if (!scope) throw new BadRequestException('Profile is not initialized');
    const venue = await this.prisma.venue.findUnique({ where: { id: scope.venueId } });
    if (!venue) throw new BadRequestException('Assigned venue not found');
    const profile = await this.prisma.profile.findUniqueOrThrow({ where: { id: scope.profileId } });
    const updated = await startBreakForProfile(this.prisma, scope.profileId, body.type);
    return mapClockEntry(updated, profile, venue);
  }

  @RequireSubscription()
  @Post('break-end')
  async endBreak(@VenueScope() scope: Scope) {
    if (!scope) throw new BadRequestException('Profile is not initialized');
    const venue = await this.prisma.venue.findUnique({ where: { id: scope.venueId } });
    if (!venue) throw new BadRequestException('Assigned venue not found');

    const profile = await this.prisma.profile.findUniqueOrThrow({ where: { id: scope.profileId } });
    const updated = await endBreakForProfile(this.prisma, scope.profileId);
    return mapClockEntry(updated, profile, venue);
  }
}
