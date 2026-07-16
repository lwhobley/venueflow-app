import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Header, NotFoundException, Param, Patch, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { IsBoolean, IsEmail, IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Prisma, Role } from '@prisma/client';
import { randomBytes, randomInt } from 'crypto';
import type { Request } from 'express';
import { AuthGuard } from '../../auth/auth.guard';
import { Public } from '../../auth/public.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../auth/auth.guard';
import { isAdminRole, isOwnerOrAdminRole } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { assertWithinGeofence } from '../../common/geofence';
import { csvCell } from '../../common/csv';
import { getClientIp } from '../../common/http';
import { hashInviteToken } from '../../common/invite-token';
import { assertWithinSharedRateLimit } from '../../common/rate-limit';
import { sanitizeForEmail } from '../../common/sanitize-email-text';
import { zonedDayOfWeek, zonedMinutesOfDay, zonedDayBounds } from '../../common/venue-time';
import { EmailService } from '../../email/email.service';
import { PrismaService } from '../../prisma/prisma.service';
import { mapClockEntry, mapProfile, mapShift, mapVenue, toMs, minutesToTime } from './app-mappers';
import { ProfileService } from './profile.service';
import { syncTeamMemberCount } from '../../common/team-sync';

const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
const STAFF_RANGES = ['1-15', '16-30', '31-50'] as const;
const FLAT_PLAN_ID = 'venueflow_monthly';
const FLAT_PLAN_PRICE_CENTS = 9999;
const PUBLIC_INVITE_RATE_LIMIT_MAX = 20;
const PUBLIC_INVITE_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

// Human-typeable invite codes. Excludes look-alike characters (0/O, 1/I/L) so
// codes read aloud or written down don't get mistyped. Format: VW-XXXXXX.
const INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function makeInviteCode(): string {
  let body = '';
  for (let i = 0; i < 6; i += 1) {
    body += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
  }
  return `VW-${body}`;
}

class BootstrapProfileDto {
  @IsString()
  @IsOptional()
  fullName?: string;

  @IsString()
  @IsOptional()
  jobTitle?: string;
}

class RegisterVenueDto {
  @IsString()
  businessName!: string;

  @IsString()
  @IsOptional()
  ownerName?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  venueType?: string;

  @IsString()
  staffRange!: string;
}

class UpdateVenueDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  @IsOptional()
  latitude?: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  @IsOptional()
  longitude?: number;

  @IsNumber()
  @Min(25)
  @IsOptional()
  geofenceRadiusM?: number;
}

class ClockDto {
  @IsNumber()
  lat!: number;

  @IsNumber()
  lng!: number;

  @IsNumber()
  accuracy!: number;

  @IsBoolean()
  mocked!: boolean;
}

class BreakStartDto {
  @IsString()
  @IsIn(['paid', 'unpaid'])
  type!: 'paid' | 'unpaid';
}

class VenueRoleDto {
  @IsString()
  name!: string;
}

class CreateInviteDto {
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsIn(['manager', 'staff'])
  role!: 'manager' | 'staff';

  @IsString()
  @IsOptional()
  jobTitle?: string;
}

class JoinByCodeDto {
  @IsString()
  code!: string;
}

class RedeemInviteDto {
  @IsString()
  codeOrToken!: string;
}

function planForStaffRange(range: string) {
  void range;
  return { planId: FLAT_PLAN_ID, priceCents: FLAT_PLAN_PRICE_CENTS };
}

@Controller('v1/app')
export class AppController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly profiles: ProfileService,
  ) {}

  @UseGuards(AuthGuard)
  @Get('me')
  async getMe(@CurrentUser() user: AuthUser) {
    const profile = await this.getProfile(user);
    if (!profile) return null;
    const emailVerified = await this.isEmailVerified(user.sub);
    return {
      profile: mapProfile(profile, emailVerified),
      venue: profile.venue ? mapVenue(profile.venue) : null,
    };
  }

  @UseGuards(AuthGuard)
  @Post('bootstrap-profile')
  async bootstrapProfile(@CurrentUser() user: AuthUser, @Body() body: BootstrapProfileDto) {
    await this.ensureUser(user);
    const emailVerified = await this.isEmailVerified(user.sub);
    const existingProfile = await this.prisma.profile.findUnique({
      where: { userId: user.sub },
      select: { email: true },
    });
    const email = user.email ?? existingProfile?.email ?? `${user.sub}@venuewrangler.local`;
    const fullName = body.fullName?.trim() || user.name || email.split('@')[0] || 'Team Member';
    const profile = await this.prisma.profile.upsert({
      where: { userId: user.sub },
      update: {
        email,
        fullName,
        jobTitle: body.jobTitle ?? 'Staff',
      },
      create: {
        userId: user.sub,
        email,
        fullName,
        role: 'staff',
        jobTitle: body.jobTitle ?? 'Staff',
        trialEndsAt: new Date(Date.now() + TRIAL_DURATION_MS),
      },
      include: { venue: true },
    });

    const venueName = profile.venue?.name ?? 'your venue';
    void this.email.send({
      to: profile.email,
      subject: 'Your Venue Wrangler Account Was Updated',
      text:
        `Hi ${profile.fullName},\n\n` +
        `Your Venue Wrangler account profile was successfully updated. Here are your current profile details:\n\n` +
        `Updated Profile Details\n` +
        `Detail\tInfo\n` +
        `Name\t${profile.fullName}\n` +
        `Role\t${profile.role}\n` +
        `Job Title\t${profile.jobTitle}\n` +
        (profile.venueId ? `Venue\t${venueName}\n` : '') + '\n' +
        `If you have any questions or did not authorize this, please contact support.\n\n` +
        `Questions? support@venuewrangler.com\n\n` +
        `— The Venue Wrangler Team`,
    });

    return {
      profile: mapProfile(profile, emailVerified),
      venue: profile.venue ? mapVenue(profile.venue) : null,
    };
  }

  @UseGuards(AuthGuard)
  @Post('register-venue')
  async registerVenue(@CurrentUser() user: AuthUser, @Body() body: RegisterVenueDto) {
    await this.ensureUser(user);
    const businessName = body.businessName.trim();
    if (!businessName) throw new BadRequestException('Enter your business name');
    if (!STAFF_RANGES.includes(body.staffRange as (typeof STAFF_RANGES)[number])) throw new BadRequestException('Choose a staff size range');

    // The intended client flow already routes signup through email
    // verification before create-venue; enforce it server-side too so a
    // direct API call can't create a venue (and start a trial) on an
    // unverified account.
    if (!(await this.isEmailVerified(user.sub))) {
      throw new ForbiddenException('Verify your email before creating a venue.');
    }

    const existingProfile = await this.getProfile(user);
    if (existingProfile?.venue) {
      const emailVerified = await this.isEmailVerified(user.sub);
      return {
        profile: mapProfile(existingProfile, emailVerified),
        venue: mapVenue(existingProfile.venue),
      };
    }

    const plan = planForStaffRange(body.staffRange);
    const trialStartedAt = new Date();
    const trialEndsAt = new Date(trialStartedAt.getTime() + TRIAL_DURATION_MS);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`register-venue:${user.sub}`}))`;
      // Re-check inside the transaction so a double-submit doesn't create a
      // second venue + subscription for an owner who already has one.
      const current = await tx.profile.findUnique({ where: { userId: user.sub }, include: { venue: true } });
      if (current?.venue) {
        return { profile: current, venue: current.venue };
      }
      const venue = await tx.venue.create({
        data: {
          name: businessName,
          latitude: 0,
          longitude: 0,
          geofenceRadiusM: 150,
          phone: body.phone?.trim() || null,
          address: body.address?.trim() || null,
          venueType: body.venueType?.trim() || null,
          staffRange: body.staffRange,
          subscriptionStatus: 'trialing',
          subscriptionPlatform: null,
        },
      });
      await tx.subscription.create({
        data: {
          venueId: venue.id,
          status: 'trialing',
          platform: null,
          planId: plan.planId,
          priceCents: plan.priceCents,
          currency: 'USD',
          trialStartedAt,
          trialEndsAt,
          cancelAtPeriodEnd: false,
        },
      });
      const profile = await tx.profile.upsert({
        where: { userId: user.sub },
        update: {
          venueId: venue.id,
          role: 'admin',
          jobTitle: 'Owner',
          fullName: body.ownerName?.trim() || existingProfile?.fullName || user.name || 'Owner',
        },
        create: {
          userId: user.sub,
          email: user.email ?? `${user.sub}@venuewrangler.local`,
          fullName: body.ownerName?.trim() || user.name || 'Owner',
          role: 'admin',
          jobTitle: 'Owner',
          venueId: venue.id,
          trialEndsAt,
        },
      });
      await syncTeamMemberCount(tx, venue.id);
      return { profile, venue };
    });

    return { profile: mapProfile(result.profile), venue: mapVenue(result.venue) };
  }

  @UseGuards(AuthGuard)
  @Patch('venue')
  async updateVenue(@CurrentUser() user: AuthUser, @Body() body: UpdateVenueDto) {
    const profile = await this.requireManagerProfile(user);
    if (!profile.venueId) return { venue: null };
    const venue = await this.prisma.venue.update({
      where: { id: profile.venueId },
      data: {
        ...(body.name?.trim() ? { name: body.name.trim() } : {}),
        ...(body.latitude !== undefined ? { latitude: body.latitude } : {}),
        ...(body.longitude !== undefined ? { longitude: body.longitude } : {}),
        ...(body.geofenceRadiusM !== undefined ? { geofenceRadiusM: Math.max(25, Math.min(2000, body.geofenceRadiusM)) } : {}),
      },
    });
    return mapVenue(venue);
  }

  @UseGuards(AuthGuard)
  @RequireSubscription()
  @Get('dashboard')
  async getDashboard(@CurrentUser() user: AuthUser) {
    const profile = await this.requireVenueProfile(user);
    if (!profile?.venue) return null;
    const canManage = isAdminRole(profile.role);
    const shiftWhere = {
      venueId: profile.venueId!,
      ...(canManage ? {} : { OR: [{ profileId: profile.id }, { status: 'open' as const }] }),
    };
    // Counts come from aggregates over all matching rows; the display list is
    // capped separately so analytics stay correct past the display limit.
    const [shifts, shiftCounts, teamCount, activeEntries, openClockCount] = await Promise.all([
      this.prisma.scheduleShift.findMany({
        where: shiftWhere,
        include: { profile: true },
        orderBy: [{ dayIndex: 'asc' }, { startMinutes: 'asc' }],
        take: 14,
      }),
      this.prisma.scheduleShift.groupBy({ by: ['status'], where: shiftWhere, _count: { _all: true } }),
      canManage ? this.prisma.profile.count({ where: { venueId: profile.venueId! } }) : Promise.resolve(0),
      canManage
        ? this.prisma.timeEntry.findMany({
            where: { venueId: profile.venueId!, isOpen: true },
            include: { profile: true, venue: true },
            take: 50,
          })
        : Promise.resolve([]),
      canManage ? this.prisma.timeEntry.count({ where: { venueId: profile.venueId!, isOpen: true } }) : Promise.resolve(0),
    ]);
    const countByStatus = (status: string) => shiftCounts.find((c) => c.status === status)?._count._all ?? 0;

    return {
      profile: mapProfile(profile),
      venue: mapVenue(profile.venue),
      analytics: {
        teamCount,
        scheduledCount: countByStatus('scheduled'),
        openShiftCount: countByStatus('open'),
        coveredShiftCount: countByStatus('covered'),
        openClockCount,
        clockedInCount: openClockCount,
      },
      schedule: shifts.map((shift) => mapShift(shift, canManage ? shift.profile?.fullName ?? null : shift.profileId === profile.id ? 'You' : null)),
      activeClockEntries: activeEntries.map((entry) => mapClockEntry(entry, entry.profile, entry.venue)),
    };
  }

  @UseGuards(AuthGuard)
  @RequireSubscription()
  @Get('manager-insights')
  async getManagerInsights(@CurrentUser() user: AuthUser) {
    const profile = await this.requireVenueProfile(user);
    if (!profile?.venueId || !isAdminRole(profile.role)) return null;
    const venueId = profile.venueId;
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [completedEntries, scheduledShifts, openRequests] = await Promise.all([
      this.prisma.timeEntry.findMany({
        where: { venueId, isOpen: false, clockOutAt: { gte: weekAgo } },
        select: { clockInAt: true, clockOutAt: true },
      }),
      this.prisma.scheduleShift.count({ where: { venueId, status: 'scheduled' } }),
      this.prisma.staffRequest.count({ where: { venueId, status: 'pending' } }),
    ]);
    const laborMs = completedEntries.reduce((sum, e) => sum + (e.clockOutAt!.getTime() - e.clockInAt.getTime()), 0);
    const laborHours = Math.round((laborMs / 3600000) * 10) / 10;
    return { laborHours, scheduledShifts, openRequests };
  }

  @UseGuards(AuthGuard)
  @Get('time-entries/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="time-entries.csv"')
  async exportTimeEntriesCsv(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const entries = await this.prisma.timeEntry.findMany({
      where: { venueId },
      include: { profile: true },
      orderBy: { clockInAt: 'desc' },
      take: 1000,
    });
    const header = 'id,memberId,memberName,clockInAt,clockOutAt,hoursWorked\n';
    const rows = entries
      .map((e) => {
        const hours = e.clockOutAt
          ? Math.round(((e.clockOutAt.getTime() - e.clockInAt.getTime()) / 3600000) * 100) / 100
          : '';
        return [
          csvCell(e.id),
          csvCell(e.profileId ?? ''),
          csvCell(e.profile?.fullName ?? e.profileFullName ?? 'Former staff'),
          csvCell(e.clockInAt.toISOString()),
          csvCell(e.clockOutAt?.toISOString() ?? ''),
          csvCell(hours),
        ].join(',');
      })
      .join('\n');
    return header + rows;
  }

  @UseGuards(AuthGuard)
  @RequireSubscription()
  @Get('notifications')
  async getNotifications(@CurrentUser() user: AuthUser) {
    const profile = await this.requireVenueProfile(user);
    const rows = await this.prisma.notificationEvent.findMany({
      where: {
        venueId: profile.venueId!,
        OR: [
          { audience: 'staff' },
          ...(isAdminRole(profile.role) ? [{ audience: 'managers' }] : []),
          { audience: 'profile', profileId: profile.id },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const reads = await this.prisma.notificationRead.findMany({
      where: { profileId: profile.id, notificationId: { in: rows.map((row) => row.id) } },
    });
    const readIds = new Set(reads.map((read) => read.notificationId));
    return rows.map((row) => ({
      _id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      createdAt: row.createdAt.getTime(),
      read: readIds.has(row.id),
    }));
  }

  @UseGuards(AuthGuard)
  @Post('notifications/:id/read')
  async markNotificationRead(@CurrentUser() user: AuthUser, @Param('id') notificationId: string) {
    const profile = await this.getProfile(user);
    if (!profile?.venueId) throw new ForbiddenException('Profile is not initialized');
    const row = await this.prisma.notificationEvent.findFirst({ where: { id: notificationId, venueId: profile.venueId } });
    if (!row) throw new NotFoundException('Notification not found');
    const canRead = row.audience === 'staff' || (row.audience === 'managers' && isAdminRole(profile.role)) || (row.audience === 'profile' && row.profileId === profile.id);
    if (!canRead) throw new ForbiddenException('Not authorized');
    await this.prisma.notificationRead.upsert({
      where: { notificationId_profileId: { notificationId, profileId: profile.id } },
      update: { readAt: new Date() },
      create: { notificationId, profileId: profile.id, venueId: profile.venueId },
    });
    return { ok: true };
  }

  @UseGuards(AuthGuard)
  @RequireSubscription()
  @Get('clock-board')
  async getClockBoard(@CurrentUser() user: AuthUser) {
    const profile = await this.requireVenueProfile(user);
    const entries = await this.prisma.timeEntry.findMany({
      where: { venueId: profile.venueId!, isOpen: true },
      include: { profile: true, venue: true },
      orderBy: { clockInAt: 'desc' },
      take: 100,
    });
    const openEntries = entries.map((entry) => mapClockEntry(entry, entry.profile, entry.venue));
    return {
      venue: mapVenue(profile.venue!),
      activeClockEntries: isAdminRole(profile.role) ? openEntries : [],
      employeeEntry: openEntries.find((entry) => entry.memberId === profile.id) ?? null,
      managerAlerts: [],
    };
  }

  @UseGuards(AuthGuard)
  @RequireSubscription()
  @Get('time-clock')
  async getMyTimeClock(@CurrentUser() user: AuthUser) {
    const profile = await this.requireVenueProfile(user);
    const entries = await this.prisma.timeEntry.findMany({
      where: { profileId: profile.id },
      orderBy: { clockInAt: 'desc' },
      take: 100,
    });
    const open = entries.find((entry) => entry.isOpen) ?? null;
    const todayStart = new Date(zonedDayBounds(profile.venue?.timezone ?? null, 0).start);
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const punches = entries
      .flatMap((entry) => [
        ...(entry.clockInAt >= todayStart ? [{ type: 'in' as const, at: entry.clockInAt.getTime() }] : []),
        ...(entry.clockOutAt && entry.clockOutAt >= todayStart ? [{ type: 'out' as const, at: entry.clockOutAt.getTime() }] : []),
      ])
      .sort((a, b) => a.at - b.at);
    const regularHours = entries.reduce((sum, entry) => {
      if (!entry.clockOutAt || entry.clockOutAt.getTime() < weekAgo) return sum;
      let durationMs = entry.clockOutAt.getTime() - entry.clockInAt.getTime();
      const breaks = (entry.breaks as any[]) || [];
      for (const b of breaks) {
        if (b.type === 'unpaid' && b.startAt && b.endAt) {
          durationMs -= (b.endAt - b.startAt);
        }
      }
      return sum + Math.max(0, durationMs) / 3600000;
    }, 0);
    const rounded = Math.round(regularHours * 10) / 10;
    return {
      isClockedIn: Boolean(open),
      openSince: toMs(open?.clockInAt),
      regularHours: rounded,
      sickHours: profile.sickHoursAccrued,
      ptoHours: profile.ptoHoursAccrued,
      totalHours: rounded,
      punches,
    };
  }

  @UseGuards(AuthGuard)
  @Post('clock-in')
  async clockIn(@CurrentUser() user: AuthUser, @Body() body: ClockDto) {
    const profile = await this.requireVenueProfile(user);
    const venue = profile.venue;
    if (!venue) throw new ForbiddenException('Assigned venue not found');
    assertWithinGeofence(body.lat, body.lng, body.accuracy, body.mocked, venue);
    const existing = await this.prisma.timeEntry.findFirst({ where: { profileId: profile.id, isOpen: true } });
    if (existing) throw new BadRequestException('Already clocked in');

    if (!isAdminRole(profile.role)) {
      const nowMs = Date.now();
      const today = zonedDayOfWeek(venue.timezone, nowMs);
      const minutesNow = zonedMinutesOfDay(venue.timezone, nowMs);
      const shift = await this.prisma.scheduleShift.findFirst({
        where: {
          venueId: venue.id,
          profileId: profile.id,
          dayIndex: today,
          status: 'scheduled',
        },
        orderBy: { startMinutes: 'asc' },
      });
      if (shift) {
        const earlyWindow = venue.earlyClockInWindowMin ?? 10;
        if (minutesNow < shift.startMinutes - earlyWindow) {
          const formattedStart = minutesToTime(shift.startMinutes);
          throw new BadRequestException(
            `Too early to clock in. Your shift starts at ${formattedStart}. You can clock in starting ${earlyWindow} minutes prior.`
          );
        }
      }
    }

    try {
      const entry = await this.prisma.timeEntry.create({
        data: {
          profileId: profile.id,
          venueId: venue.id,
          clockInAt: new Date(),
          clockInLat: body.lat,
          clockInLng: body.lng,
          clockInAccuracyM: body.accuracy,
          clockInMocked: body.mocked,
          isOpen: true,
        },
        include: { profile: true, venue: true },
      });
      return mapClockEntry(entry, entry.profile, entry.venue);
    } catch (error: any) {
      // Partial unique index (one open entry per profile): a concurrent
      // double-tap loses the race here instead of creating a second open entry.
      if (error?.code === 'P2002') throw new BadRequestException('Already clocked in');
      throw error;
    }
  }

  @UseGuards(AuthGuard)
  @Post('clock-out')
  async clockOut(@CurrentUser() user: AuthUser, @Body() body: ClockDto) {
    const profile = await this.requireVenueProfile(user);
    const venue = profile.venue;
    if (!venue) throw new ForbiddenException('Assigned venue not found');
    assertWithinGeofence(body.lat, body.lng, body.accuracy, body.mocked, venue);
    const existing = await this.prisma.timeEntry.findFirst({ where: { profileId: profile.id, isOpen: true } });
    if (!existing) throw new BadRequestException('No active clock-in found');
    const entry = await this.prisma.timeEntry.update({
      where: { id: existing.id },
      data: {
        clockOutAt: new Date(),
        clockOutLat: body.lat,
        clockOutLng: body.lng,
        clockOutAccuracyM: body.accuracy,
        clockOutMocked: body.mocked,
        isOpen: false,
      },
      include: { profile: true, venue: true },
    });
    return mapClockEntry(entry, entry.profile, entry.venue);
  }

  @UseGuards(AuthGuard)
  @Post('time-clock/break-start')
  async startBreak(@CurrentUser() user: AuthUser, @Body() body: BreakStartDto) {
    const profile = await this.requireVenueProfile(user);
    const updated = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.timeEntry.findFirst({
        where: { profileId: profile.id, isOpen: true },
        include: { profile: true, venue: true },
      });
      if (!entry) throw new BadRequestException('No active clock-in found');
      const breaks = (entry.breaks as any[]) || [];
      if (breaks.find((b: any) => b.endAt === null)) throw new BadRequestException('Already on a break');
      const newBreaks = [...breaks, { startAt: Date.now(), endAt: null, type: body.type }];
      return tx.timeEntry.update({
        where: { id: entry.id },
        data: { breaks: newBreaks },
        include: { profile: true, venue: true },
      });
    });
    return mapClockEntry(updated, updated.profile, updated.venue);
  }

  @UseGuards(AuthGuard)
  @Post('time-clock/break-end')
  async endBreak(@CurrentUser() user: AuthUser) {
    const profile = await this.requireVenueProfile(user);
    const updated = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.timeEntry.findFirst({
        where: { profileId: profile.id, isOpen: true },
        include: { profile: true, venue: true },
      });
      if (!entry) throw new BadRequestException('No active clock-in found');
      const breaks = (entry.breaks as any[]) || [];
      const activeBreakIndex = breaks.findIndex((b: any) => b.endAt === null);
      if (activeBreakIndex === -1) throw new BadRequestException('Not currently on a break');
      const newBreaks = [...breaks];
      newBreaks[activeBreakIndex] = { ...newBreaks[activeBreakIndex], endAt: Date.now() };
      return tx.timeEntry.update({
        where: { id: entry.id },
        data: { breaks: newBreaks },
        include: { profile: true, venue: true },
      });
    });
    return mapClockEntry(updated, updated.profile, updated.venue);
  }

  @UseGuards(AuthGuard)
  @Get('venue-roles')
  async listVenueRoles(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    const roles = await this.prisma.venueRole.findMany({
      where: { venueId: profile.venueId! },
      orderBy: { name: 'asc' },
    });
    return roles.map((role) => ({ _id: role.id, id: role.id, name: role.name }));
  }

  @UseGuards(AuthGuard)
  @Post('venue-roles')
  async addVenueRole(@CurrentUser() user: AuthUser, @Body() body: VenueRoleDto) {
    const profile = await this.requireManagerProfile(user);
    const name = body.name.trim();
    if (!name) throw new BadRequestException('Enter a role name');
    const existing = await this.prisma.venueRole.findFirst({
      where: { venueId: profile.venueId!, name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) return { _id: existing.id, id: existing.id, name: existing.name };
    const role = await this.prisma.venueRole.create({
      data: { venueId: profile.venueId!, name },
    });
    return { _id: role.id, id: role.id, name: role.name };
  }

  @UseGuards(AuthGuard)
  @Delete('venue-roles/:id')
  async removeVenueRole(@CurrentUser() user: AuthUser, @Param('id') roleId: string) {
    const profile = await this.requireManagerProfile(user);
    const role = await this.prisma.venueRole.findFirst({ where: { id: roleId, venueId: profile.venueId! } });
    if (!role) throw new NotFoundException('Role not found');
    await this.prisma.venueRole.delete({ where: { id: role.id } });
    return { ok: true };
  }

  @UseGuards(AuthGuard)
  @Post('invites')
  async createInvite(@CurrentUser() user: AuthUser, @Body() body: CreateInviteDto) {
    const profile = await this.requireManagerProfile(user);
    // Only owner, admin, or allAccess profiles may create manager-level invites.
    // A plain manager can only invite staff, matching the canManageRole policy
    // enforced on direct staff edits.
    const canElevate = profile.role === 'owner' || profile.role === 'admin' || profile.allAccess;
    const inviteRole = body.role === 'manager' && canElevate ? 'manager' : 'staff';
    const email = body.email?.trim().toLowerCase() || null;
    // The plaintext token is only ever needed for the instant it's embedded
    // in the deep-link/response/email below — only its hash is persisted
    // (Invite.tokenHash), so a DB dump/backup leak can't yield a usable
    // signup link. Use this local variable everywhere below, never re-read
    // `invite.token` from the DB.
    const token = randomBytes(18).toString('base64url');
    const tokenHash = hashInviteToken(token);
    const code = await this.uniqueInviteCode();
    const invite = await this.prisma.invite.create({
      data: {
        venueId: profile.venueId!,
        email,
        tokenHash,
        code,
        role: inviteRole,
        jobTitle: body.jobTitle?.trim() || 'Team Member',
        createdBy: profile.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    const inviteUrl = `venuewrangler://join?invite=${encodeURIComponent(token)}`;
    const venueName = sanitizeForEmail(profile.venue?.name ?? 'your Venue Wrangler team');
    if (email) {
      void this.email.send({
        to: email,
        subject: `Invitation: Join the Team at ${venueName} on Venue Wrangler`,
        text:
          `Hi there,\n\n` +
          `You have been invited by ${profile.fullName} to join the team at ${venueName} on Venue Wrangler.\n\n` +
          `To accept your invitation and join the venue:\n\n` +
          `1. Open the Venue Wrangler app on your phone and choose "Join a team"\n` +
          `2. Enter the following invite code when prompted:\n\n` +
          `   ${code}\n\n` +
          `Alternatively, you can tap this link directly on your mobile device:\n` +
          `${inviteUrl}\n\n` +
          `Note: This invitation is valid for 7 days.\n\n` +
          `Questions? support@venuewrangler.com\n\n` +
          `— The Venue Wrangler Team`,
      });
    }
    return {
      token,
      code: invite.code,
      inviteUrl,
      expiresAt: invite.expiresAt.getTime(),
    };
  }

  // Public: lets the join screen show which team a code belongs to before the
  // employee creates an account. Returns nothing identifying beyond the team
  // name and the role they'd get.
  @Public()
  @Get('invite/:code')
  async previewInvite(@Req() request: Request, @Param('code') rawCode: string) {
    await assertWithinSharedRateLimit(
      this.prisma,
      `public-invite:${getClientIp(request)}`,
      PUBLIC_INVITE_RATE_LIMIT_MAX,
      PUBLIC_INVITE_RATE_LIMIT_WINDOW_MS,
    );
    const invite = await this.findRedeemableInvite({ codeOrToken: rawCode });
    if (!invite) throw new NotFoundException('That invite code is invalid, used, or expired.');
    const venue = await this.prisma.venue.findUnique({ where: { id: invite.venueId }, select: { name: true } });
    return {
      valid: true,
      venueName: venue?.name ?? 'a Venue Wrangler team',
      role: invite.role,
      jobTitle: invite.jobTitle,
      expiresAt: invite.expiresAt.getTime(),
    };
  }

  // Authenticated: lets a solo user (no venue yet) join a team later by code.
  @UseGuards(AuthGuard)
  @Post('join')
  async joinByCode(@Req() request: Request, @CurrentUser() user: AuthUser, @Body() body: JoinByCodeDto) {
    // Codes are short (6-char, ~30-symbol alphabet); without a per-user rate
    // limit an authenticated attacker could brute-force one and join a
    // stranger's venue.
    await assertWithinSharedRateLimit(this.prisma, `join-code:${user.sub}`, PUBLIC_INVITE_RATE_LIMIT_MAX, PUBLIC_INVITE_RATE_LIMIT_WINDOW_MS);
    await assertWithinSharedRateLimit(this.prisma, `join-code:ip:${getClientIp(request)}`, PUBLIC_INVITE_RATE_LIMIT_MAX, PUBLIC_INVITE_RATE_LIMIT_WINDOW_MS);
    const profile = await this.getProfile(user);
    if (!profile) throw new NotFoundException('Profile not found');
    if (profile.venueId) throw new BadRequestException('You are already part of a team.');
    const verifiedEmail = await this.getVerifiedAccountEmail(user.sub);

    const updated = await this.prisma.$transaction(async (tx) => {
      const invite = await this.findRedeemableInvite({ codeOrToken: body.code }, tx);
      if (!invite) throw new BadRequestException('That invite code is invalid, used, or expired.');
      if (invite.email && invite.email.toLowerCase() !== verifiedEmail.toLowerCase()) {
        throw new ForbiddenException('This invite was sent to a different email address.');
      }
      // Atomic single-use claim — the loser of a race sees count 0.
      const claimed = await tx.invite.updateMany({
        where: { id: invite.id, usedBy: null },
        data: { usedBy: profile.id },
      });
      if (claimed.count === 0) throw new BadRequestException('That invite has already been used.');
      const up = await tx.profile.update({
        where: { id: profile.id },
        data: { venueId: invite.venueId, role: invite.role, jobTitle: invite.jobTitle },
        include: { venue: true },
      });
      await syncTeamMemberCount(tx, invite.venueId);
      return up;
    });

    const emailVerified = await this.isEmailVerified(user.sub);
    return {
      profile: mapProfile(updated, emailVerified),
      venue: updated.venue ? mapVenue(updated.venue) : null,
    };
  }

  @UseGuards(AuthGuard)
  @Post('redeem-invite')
  async redeemInvite(@Req() request: Request, @CurrentUser() user: AuthUser, @Body() body: RedeemInviteDto) {
    // Same brute-force concern as /join — this also accepts the short code.
    await assertWithinSharedRateLimit(this.prisma, `redeem-invite:${user.sub}`, PUBLIC_INVITE_RATE_LIMIT_MAX, PUBLIC_INVITE_RATE_LIMIT_WINDOW_MS);
    await assertWithinSharedRateLimit(this.prisma, `redeem-invite:ip:${getClientIp(request)}`, PUBLIC_INVITE_RATE_LIMIT_MAX, PUBLIC_INVITE_RATE_LIMIT_WINDOW_MS);
    return this.redeemInviteForUser(user.sub, { codeOrToken: body.codeOrToken });
  }

  @UseGuards(AuthGuard)
  @Post('redeem-my-invite')
  async redeemMyInvite(@CurrentUser() user: AuthUser) {
    const email = await this.getVerifiedAccountEmail(user.sub);
    const matches = await this.prisma.invite.findMany({
      where: {
        email: { equals: email, mode: 'insensitive' },
        usedBy: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      take: 2,
    });
    if (matches.length === 0) {
      const unclaimedProfile = await this.prisma.profile.findFirst({
        where: {
          userId: null,
          email: { equals: email, mode: 'insensitive' },
          venueId: { not: null },
        },
        include: { venue: true },
      });

      if (!unclaimedProfile) {
        return { redeemed: false };
      }

      const profile = await this.getProfile(user);
      if (!profile) throw new NotFoundException('Profile not found');

      const updated = await this.prisma.$transaction(async (tx) => {
        // Delete temporary profile created on signup
        await tx.profile.delete({
          where: { id: profile.id },
        });

        // Adopt the unclaimed profile
        return tx.profile.update({
          where: { id: unclaimedProfile.id },
          data: {
            userId: user.sub,
          },
          include: { venue: true },
        });
      });

      return {
        redeemed: true,
        profile: mapProfile(updated, true),
        venue: updated.venue ? mapVenue(updated.venue) : null,
      };
    }
    if (matches.length > 1) {
      throw new BadRequestException('Multiple pending invites were found for this email. Use the specific invite link from your manager.');
    }
    return this.redeemInviteForUser(user.sub, { id: matches[0].id });
  }

  // Resolve a redeemable invite either by an already-known row id (the caller
  // already looked it up some other way, e.g. by the redeemer's verified
  // email — no plaintext token involved) or by a user-submitted short code /
  // long token (the token is never stored in plaintext, so it's hashed
  // before the lookup).
  private findRedeemableInvite(
    identifier: { id: string } | { codeOrToken: string },
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    if ('id' in identifier) {
      return tx.invite.findFirst({
        where: { id: identifier.id, usedBy: null, expiresAt: { gt: new Date() } },
      });
    }
    const value = identifier.codeOrToken?.trim();
    if (!value) return Promise.resolve(null);
    return tx.invite.findFirst({
      where: {
        OR: [{ code: { equals: value, mode: 'insensitive' } }, { tokenHash: hashInviteToken(value) }],
        usedBy: null,
        expiresAt: { gt: new Date() },
      },
    });
  }

  private async uniqueInviteCode(): Promise<string> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const code = makeInviteCode();
      const clash = await this.prisma.invite.findUnique({ where: { code } });
      if (!clash) return code;
    }
    // Astronomically unlikely; widen with a longer suffix as a last resort.
    return `${makeInviteCode()}${randomBytes(2).toString('hex').toUpperCase()}`;
  }

  @UseGuards(AuthGuard)
  @Delete('me')
  async deleteMyAccount(@CurrentUser() user: AuthUser) {
    const profile = await this.getProfile(user);
    if (!profile) return { ok: true };
    const deletedAccountEmail = profile.email;
    const deletedAccountName = profile.fullName;
    await this.prisma.$transaction(async (tx) => {
      if (profile.venueId && isOwnerOrAdminRole(profile.role)) {
        // Advisory-lock the venue so two concurrent last-admin deletions can't
        // both read the same pre-delete count and both pass the guard.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`venue-admin-count:${profile.venueId}`}))`;
        const [ownerAdminCount, memberCount] = await Promise.all([
          tx.profile.count({ where: { venueId: profile.venueId, role: { in: ['owner', 'admin'] } } }),
          tx.profile.count({ where: { venueId: profile.venueId } }),
        ]);
        // A sole remaining member may delete (orphaning an empty venue is fine,
        // and App Store guideline 5.1.1(v) requires in-app account deletion).
        // Block only when other staff remain but this is the last owner/admin.
        if (ownerAdminCount <= 1 && memberCount > 1) {
          throw new ForbiddenException('Transfer venue ownership or add another admin before deleting this account');
        }
      }
      await tx.pushToken.deleteMany({ where: { profileId: profile.id } });
      await tx.availability.deleteMany({ where: { profileId: profile.id } });
      // Time entries are employer wage records (FLSA retention) — keep them.
      // Snapshot the name; deleting the profile then SetNulls the linkage.
      await tx.timeEntry.updateMany({
        where: { profileId: profile.id },
        data: { profileFullName: profile.fullName, isOpen: false },
      });
      await tx.scheduleShift.updateMany({ where: { profileId: profile.id }, data: { profileId: null, status: 'open' } });
      await tx.session.deleteMany({ where: { userId: user.sub } });
      await tx.authAccount.deleteMany({ where: { userId: user.sub } });
      await tx.profile.delete({ where: { id: profile.id } });
      await tx.user.deleteMany({ where: { id: user.sub } });
      if (profile.venueId) {
        await syncTeamMemberCount(tx, profile.venueId);
      }
    });
    void this.email.send({
      to: deletedAccountEmail,
      subject: 'Your Venue Wrangler Account Has Been Deleted',
      text:
        `Hi ${deletedAccountName},\n\n` +
        `Your Venue Wrangler account has been successfully deleted.\n\n` +
        `Please note that any retained timeclock records remain available to the venue as employer wage and compliance records in accordance with federal and local regulations.\n\n` +
        `Thank you for using Venue Wrangler.\n\n` +
        `Questions? support@venuewrangler.com\n\n` +
        `— The Venue Wrangler Team`,
    });
    return { ok: true };
  }

  private ensureUser(user: AuthUser) {
    return this.profiles.ensureUser(user);
  }

  private getProfile(user: AuthUser) {
    return this.profiles.getProfile(user);
  }

  private requireVenueProfile(user: AuthUser) {
    return this.profiles.requireVenueProfile(user);
  }

  private requireManagerProfile(user: AuthUser) {
    return this.profiles.requireManagerProfile(user);
  }

  private requireBillingProfile(user: AuthUser) {
    return this.profiles.requireBillingProfile(user);
  }



  private getVerifiedAccountEmail(userId: string) {
    return this.profiles.getVerifiedAccountEmail(userId);
  }

  private isEmailVerified(userId: string) {
    return this.profiles.isEmailVerified(userId);
  }

  private async redeemInviteForUser(userId: string, identifier: { id: string } | { codeOrToken: string }) {
    const email = await this.getVerifiedAccountEmail(userId);
    const profile = await this.getProfile({ sub: userId });
    if (!profile) throw new NotFoundException('Profile not found');
    if (profile.venueId) {
      const emailVerified = await this.isEmailVerified(userId);
      return {
        redeemed: false,
        profile: mapProfile(profile, emailVerified),
        venue: profile.venue ? mapVenue(profile.venue) : null,
      };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const invite = await this.findRedeemableInvite(identifier, tx);
      if (!invite) throw new BadRequestException('That invite code is invalid, used, or expired.');
      // Email-specific invites: enforce that the redeeming user's verified email
      // matches the invite's target. Link-based invites (no email on the invite)
      // are open to any authenticated user — the short-lived token is the auth.
      if (invite.email && invite.email.toLowerCase() !== email.toLowerCase()) {
        throw new ForbiddenException('This invite was sent to a different email address.');
      }
      const claimed = await tx.invite.updateMany({
        where: { id: invite.id, usedBy: null },
        data: { usedBy: profile.id },
      });
      if (claimed.count === 0) {
        throw new BadRequestException('That invite has already been used.');
      }
      const up = await tx.profile.update({
        where: { id: profile.id },
        data: {
          email,
          venueId: invite.venueId,
          role: invite.role,
          jobTitle: invite.jobTitle,
        },
        include: { venue: true },
      });
      await syncTeamMemberCount(tx, invite.venueId);
      return up;
    });

    return {
      redeemed: true,
      profile: mapProfile(updated, true),
      venue: updated.venue ? mapVenue(updated.venue) : null,
    };
  }

}
