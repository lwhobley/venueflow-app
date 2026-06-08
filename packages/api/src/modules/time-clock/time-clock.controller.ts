import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
} from '@nestjs/common';
import { IsBoolean, IsNumber } from 'class-validator';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../auth/auth.guard';
import { isAdminRole } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { assertWithinGeofence } from '../../common/geofence';
import { mapClockEntry, minutesToTime } from '../../common/mappers';
import { PrismaService } from '../../prisma/prisma.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';

type Scope = VenueScopedRequest['venueScope'];

class ClockPunchDto {
  @IsNumber()
  lat!: number;

  @IsNumber()
  lng!: number;

  @IsNumber()
  accuracy!: number;

  @IsBoolean()
  mocked!: boolean;
}

@Controller('v1/time-clock')
export class TimeClockController {
  constructor(private readonly prisma: PrismaService) {}

  @RequireSubscription()
  @Get('board')
  async getClockBoard(@VenueScope() scope: Scope) {
    if (!scope) return null;
    const venue = await this.prisma.venue.findUnique({ where: { id: scope.venueId } });
    if (!venue) return null;

    // The board only surfaces open entries and alerts derived from them, so we
    // never need the venue's full (unbounded) time-entry history.
    const entries = await this.prisma.timeEntry.findMany({
      where: { venueId: venue.id, isOpen: true },
      include: { profile: true },
    });

    const openEntries = entries
      .filter((entry) => entry.isOpen && entry.profile)
      .map((entry) => mapClockEntry(entry, entry.profile, venue));

    const myOpenEntry = openEntries.find((item) => item.memberId === scope.profileId) ?? null;

    const managerAlerts: Array<{
      kind: 'late_clock_in' | 'missed_clock_out';
      severity: 'warning' | 'danger';
      profileId: string;
      memberName: string;
      detail: string;
    }> = [];

    if (isAdminRole(scope.role)) {
      const now = Date.now();
      const today = new Date().getDay();
      const minutesNow = new Date().getHours() * 60 + new Date().getMinutes();
      const openByProfile = new Set(
        entries.filter((entry) => entry.isOpen).map((entry) => entry.profileId),
      );
      const shifts = await this.prisma.scheduleShift.findMany({
        where: { venueId: venue.id },
        include: { profile: true },
      });
      for (const shift of shifts) {
        if (shift.dayIndex !== today || !shift.profileId || shift.status === 'open') continue;
        if (
          minutesNow >= shift.startMinutes + 15 &&
          minutesNow <= shift.endMinutes &&
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
            detail: `Clocked in since ${entry.clockInAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`,
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
        subscriptionStatus: venue.subscriptionStatus ?? null,
        subscriptionPlatform: venue.subscriptionPlatform ?? null,
      },
      activeClockEntries: openEntries,
      employeeEntry: myOpenEntry,
      managerAlerts: managerAlerts.slice(0, 8),
    };
  }

  @Get('me')
  async getMyTimeClock(@CurrentUser() user: AuthUser) {
    const profile = await this.prisma.profile.findFirst({ where: { userId: user.sub } });
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

    const startOfToday = new Date().setHours(0, 0, 0, 0);
    const now = Date.now();
    const punches: { type: 'in' | 'out'; at: number }[] = [];
    for (const entry of all) {
      const inAt = entry.clockInAt.getTime();
      if (inAt >= startOfToday) punches.push({ type: 'in', at: inAt });
      const outAt = entry.clockOutAt?.getTime();
      if (outAt && outAt >= startOfToday) punches.push({ type: 'out', at: outAt });
    }
    punches.sort((a, b) => a.at - b.at);

    const weekMs = 1000 * 60 * 60 * 24 * 7;
    const regularHours = closed.reduce((sum, entry) => {
      const outAt = entry.clockOutAt?.getTime();
      if (!outAt || now - outAt > weekMs) return sum;
      return sum + (outAt - entry.clockInAt.getTime()) / 3600000;
    }, 0);
    const round1 = (n: number) => Math.round(n * 10) / 10;

    return {
      isClockedIn: open.length > 0,
      openSince: open[0]?.clockInAt.getTime() ?? null,
      regularHours: round1(regularHours),
      sickHours: 0,
      totalHours: round1(regularHours),
      punches,
    };
  }

  @RequireSubscription()
  @Post('clock-in')
  async clockIn(@VenueScope() scope: Scope, @Body() body: ClockPunchDto) {
    if (!scope) throw new BadRequestException('Profile is not initialized');
    const venue = await this.prisma.venue.findUnique({ where: { id: scope.venueId } });
    if (!venue) throw new BadRequestException('Assigned venue not found');
    assertWithinGeofence(body.lat, body.lng, body.accuracy, body.mocked, venue);

    const active = await this.prisma.timeEntry.findFirst({
      where: { profileId: scope.profileId, isOpen: true },
    });
    if (active) throw new BadRequestException('Already clocked in');

    const profile = await this.prisma.profile.findUniqueOrThrow({ where: { id: scope.profileId } });
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
  async clockOut(@VenueScope() scope: Scope, @Body() body: ClockPunchDto) {
    if (!scope) throw new BadRequestException('Profile is not initialized');
    const venue = await this.prisma.venue.findUnique({ where: { id: scope.venueId } });
    if (!venue) throw new BadRequestException('Assigned venue not found');
    assertWithinGeofence(body.lat, body.lng, body.accuracy, body.mocked, venue);

    const active = await this.prisma.timeEntry.findFirst({
      where: { profileId: scope.profileId, isOpen: true },
    });
    if (!active) throw new BadRequestException('No active clock-in found');

    const profile = await this.prisma.profile.findUniqueOrThrow({ where: { id: scope.profileId } });
    const entry = await this.prisma.timeEntry.update({
      where: { id: active.id },
      data: {
        clockOutAt: new Date(),
        clockOutLat: body.lat,
        clockOutLng: body.lng,
        clockOutAccuracyM: body.accuracy,
        clockOutMocked: body.mocked,
        isOpen: false,
      },
    });
    return mapClockEntry(entry, profile, venue);
  }
}
