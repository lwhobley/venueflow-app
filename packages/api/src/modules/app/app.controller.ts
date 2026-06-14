import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Header, NotFoundException, Param, Patch, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsBoolean, IsEmail, IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Prisma, Role, SubscriptionStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import type { Request } from 'express';
import { AuthGuard } from '../../auth/auth.guard';
import { Public } from '../../auth/public.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../auth/auth.guard';
import { canManageRole, isOwnerOrAdminRole } from '../../auth/roles';
import { assertWithinGeofence } from '../../common/geofence';
import { csvCell } from '../../common/csv';
import { getClientIp } from '../../common/http';
import { assertWithinSharedRateLimit } from '../../common/rate-limit';
import { EmailService } from '../../email/email.service';
import { PrismaService } from '../../prisma/prisma.service';

const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
const STAFF_RANGES = ['1-15', '16-30', '31-50'] as const;
const FLAT_PLAN_ID = 'venueflow_monthly';
const FLAT_PLAN_PRICE_CENTS = 2999;
const PUBLIC_INVITE_RATE_LIMIT_MAX = 20;
const PUBLIC_INVITE_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

// Human-typeable invite codes. Excludes look-alike characters (0/O, 1/I/L) so
// codes read aloud or written down don't get mistyped. Format: VW-XXXXXX.
const INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function makeInviteCode(): string {
  let body = '';
  for (let i = 0; i < 6; i += 1) {
    body += INVITE_CODE_ALPHABET[randomBytes(1)[0] % INVITE_CODE_ALPHABET.length];
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

class StaffDto {
  @IsString()
  venueId!: string;

  @IsEmail()
  email!: string;

  @IsString()
  fullName!: string;

  @IsIn(['admin', 'owner', 'manager', 'server', 'staff'])
  role!: Role;

  @IsString()
  jobTitle!: string;
}

class VenueRoleDto {
  @IsString()
  name!: string;
}

class AppleSubscriptionSyncDto {
  @IsString()
  productId!: string;

  @IsString()
  @IsOptional()
  entitlementId?: string;
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

function isAdminRole(role: Role) {
  return role === 'admin' || role === 'owner' || role === 'manager';
}

function planForStaffRange(range: string) {
  void range;
  return { planId: FLAT_PLAN_ID, priceCents: FLAT_PLAN_PRICE_CENTS };
}

function toMs(date: Date | null | undefined) {
  return date ? date.getTime() : null;
}

function minutesToTime(total: number) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

function dayLabel(dayIndex: number) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayIndex] ?? 'Day';
}

@Controller('v1/app')
export class AppController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  @UseGuards(AuthGuard)
  @Get('me')
  async getMe(@CurrentUser() user: AuthUser) {
    const profile = await this.getProfile(user);
    if (!profile) return null;
    const emailVerified = await this.isEmailVerified(user.sub);
    return {
      profile: this.mapProfile(profile, emailVerified),
      venue: profile.venue ? this.mapVenue(profile.venue) : null,
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

    void this.email.send({
      to: profile.email,
      subject: 'Your Venue Wrangler account was updated',
      text: `Hi ${profile.fullName},\n\nYour Venue Wrangler account profile was updated.`,
    });

    return {
      profile: this.mapProfile(profile, emailVerified),
      venue: profile.venue ? this.mapVenue(profile.venue) : null,
    };
  }

  @UseGuards(AuthGuard)
  @Post('register-venue')
  async registerVenue(@CurrentUser() user: AuthUser, @Body() body: RegisterVenueDto) {
    await this.ensureUser(user);
    await this.requireVerifiedUser(user.sub);
    const businessName = body.businessName.trim();
    if (!businessName) throw new BadRequestException('Enter your business name');
    if (!STAFF_RANGES.includes(body.staffRange as (typeof STAFF_RANGES)[number])) throw new BadRequestException('Choose a staff size range');

    const existingProfile = await this.getProfile(user);
    if (existingProfile?.venue) {
      const emailVerified = await this.isEmailVerified(user.sub);
      return {
        profile: this.mapProfile(existingProfile, emailVerified),
        venue: this.mapVenue(existingProfile.venue),
      };
    }

    const plan = planForStaffRange(body.staffRange);
    const trialStartedAt = new Date();
    const trialEndsAt = new Date(trialStartedAt.getTime() + TRIAL_DURATION_MS);
    const result = await this.prisma.$transaction(async (tx) => {
      // Re-check inside the transaction so a double-submit doesn't create a
      // second venue + subscription for an owner who already has one.
      const current = await tx.profile.findFirst({ where: { userId: user.sub }, include: { venue: true } });
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
      return { profile, venue };
    });

    return { profile: this.mapProfile(result.profile), venue: this.mapVenue(result.venue) };
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
        ...(body.geofenceRadiusM !== undefined ? { geofenceRadiusM: Math.max(20, Math.min(2000, body.geofenceRadiusM)) } : {}),
      },
    });
    return this.mapVenue(venue);
  }

  @UseGuards(AuthGuard)
  @Get('billing')
  async getMyVenueBilling(@CurrentUser() user: AuthUser) {
    const profile = await this.getProfile(user);
    if (!profile?.venueId) return null;
    const subscription = await this.prisma.subscription.findFirst({ where: { venueId: profile.venueId } });
    if (!subscription) return null;
    return {
      venueId: subscription.venueId,
      status: subscription.status,
      platform: subscription.platform,
      trialStartedAt: subscription.trialStartedAt.getTime(),
      trialEndsAt: subscription.trialEndsAt.getTime(),
      currentPeriodStart: toMs(subscription.currentPeriodStart),
      currentPeriodEnd: toMs(subscription.currentPeriodEnd),
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      cancelledAt: toMs(subscription.cancelledAt),
      planId: subscription.planId,
      priceCents: subscription.priceCents,
      currency: subscription.currency,
    };
  }

  @UseGuards(AuthGuard)
  @Post('billing/apple/sync')
  async syncAppleSubscription(@CurrentUser() user: AuthUser, @Body() body: AppleSubscriptionSyncDto) {
    const profile = await this.requireBillingProfile(user);
    const verified = await this.verifyRevenueCatEntitlement(profile.venueId!, body.productId, body.entitlementId);
    if (!verified) {
      return this.getMyVenueBilling(user);
    }
    const status: SubscriptionStatus = 'active';
    const now = new Date();
    const existing = await this.prisma.subscription.findFirst({ where: { venueId: profile.venueId! } });
    await this.prisma.$transaction([
      this.prisma.venue.update({
        where: { id: profile.venueId! },
        data: {
          subscriptionStatus: status,
          subscriptionPlatform: 'apple',
        },
      }),
      existing
        ? this.prisma.subscription.update({
            where: { id: existing.id },
            data: {
              status,
              platform: 'apple',
              planId: body.productId,
              currentPeriodStart: verified.currentPeriodStart ?? existing.currentPeriodStart ?? now,
              currentPeriodEnd: verified.currentPeriodEnd ?? existing.currentPeriodEnd,
              cancelAtPeriodEnd: false,
              cancelledAt: null,
              externalCustomerId: profile.venueId!,
              lastRevenueCatEventAt: now,
            },
          })
        : this.prisma.subscription.create({
            data: {
              venueId: profile.venueId!,
              status,
              platform: 'apple',
              planId: body.productId,
              priceCents: 0,
              currency: 'USD',
              trialStartedAt: now,
              trialEndsAt: now,
              currentPeriodStart: verified.currentPeriodStart ?? now,
              currentPeriodEnd: verified.currentPeriodEnd,
              cancelAtPeriodEnd: false,
              externalCustomerId: profile.venueId!,
              lastRevenueCatEventAt: now,
            },
          }),
    ]);

    return this.getMyVenueBilling(user);
  }

  @UseGuards(AuthGuard)
  @Get('dashboard')
  async getDashboard(@CurrentUser() user: AuthUser) {
    const profile = await this.getProfile(user);
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
      profile: this.mapProfile(profile),
      venue: this.mapVenue(profile.venue),
      analytics: {
        teamCount,
        scheduledCount: countByStatus('scheduled'),
        openShiftCount: countByStatus('open'),
        coveredShiftCount: countByStatus('covered'),
        openClockCount,
        clockedInCount: openClockCount,
      },
      schedule: shifts.map((shift) => this.mapShift(shift, canManage ? shift.profile?.fullName ?? null : shift.profileId === profile.id ? 'You' : null)),
      activeClockEntries: activeEntries.map((entry) => this.mapClockEntry(entry, entry.profile, entry.venue)),
    };
  }

  @UseGuards(AuthGuard)
  @Get('manager-insights')
  async getManagerInsights(@CurrentUser() user: AuthUser) {
    const profile = await this.getProfile(user);
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
  @Get('notifications')
  async getNotifications(@CurrentUser() user: AuthUser) {
    const profile = await this.getProfile(user);
    if (!profile?.venueId) return [];
    const rows = await this.prisma.notificationEvent.findMany({
      where: {
        venueId: profile.venueId,
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
  @Get('clock-board')
  async getClockBoard(@CurrentUser() user: AuthUser) {
    const profile = await this.getProfile(user);
    if (!profile?.venue) return null;
    const entries = await this.prisma.timeEntry.findMany({
      where: { venueId: profile.venueId!, isOpen: true },
      include: { profile: true, venue: true },
      orderBy: { clockInAt: 'desc' },
      take: 100,
    });
    const openEntries = entries.map((entry) => this.mapClockEntry(entry, entry.profile, entry.venue));
    return {
      venue: this.mapVenue(profile.venue),
      activeClockEntries: isAdminRole(profile.role) ? openEntries : [],
      employeeEntry: openEntries.find((entry) => entry.memberId === profile.id) ?? null,
      managerAlerts: [],
    };
  }

  @UseGuards(AuthGuard)
  @Get('time-clock')
  async getMyTimeClock(@CurrentUser() user: AuthUser) {
    const profile = await this.getProfile(user);
    if (!profile) return null;
    const entries = await this.prisma.timeEntry.findMany({
      where: { profileId: profile.id },
      orderBy: { clockInAt: 'desc' },
      take: 100,
    });
    const open = entries.find((entry) => entry.isOpen) ?? null;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const punches = entries
      .flatMap((entry) => [
        ...(entry.clockInAt >= todayStart ? [{ type: 'in' as const, at: entry.clockInAt.getTime() }] : []),
        ...(entry.clockOutAt && entry.clockOutAt >= todayStart ? [{ type: 'out' as const, at: entry.clockOutAt.getTime() }] : []),
      ])
      .sort((a, b) => a.at - b.at);
    const regularHours = entries.reduce((sum, entry) => {
      if (!entry.clockOutAt || entry.clockOutAt.getTime() < weekAgo) return sum;
      return sum + (entry.clockOutAt.getTime() - entry.clockInAt.getTime()) / 3600000;
    }, 0);
    const rounded = Math.round(regularHours * 10) / 10;
    return { isClockedIn: Boolean(open), openSince: toMs(open?.clockInAt), regularHours: rounded, sickHours: 0, totalHours: rounded, punches };
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
      return this.mapClockEntry(entry, entry.profile, entry.venue);
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
    return this.mapClockEntry(entry, entry.profile, entry.venue);
  }

  @UseGuards(AuthGuard)
  @Get('staff')
  async listVenueStaff(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    return this.prisma.profile
      .findMany({ where: { venueId: profile.venueId! }, orderBy: { fullName: 'asc' } })
      .then((rows) => rows.map((row) => this.mapProfile(row)));
  }

  @UseGuards(AuthGuard)
  @Post('staff')
  async upsertVenueStaff(@CurrentUser() user: AuthUser, @Body() body: StaffDto) {
    const viewer = await this.requireManagerProfile(user);
    if (viewer.venueId !== body.venueId) throw new ForbiddenException('Not authorized');
    const viewerIsOwnerOrAdmin = viewer.role === 'owner' || viewer.role === 'admin' || viewer.allAccess;
    if (!viewerIsOwnerOrAdmin && ['admin', 'owner', 'manager'].includes(body.role)) {
      throw new ForbiddenException('Managers cannot assign admin, owner, or manager roles');
    }
    const existing = await this.prisma.profile.findFirst({ where: { venueId: body.venueId, email: body.email.toLowerCase() } });
    if (existing) {
      await this.assertCanManageLegacyStaffTarget(viewer, existing);
    }
    const row = existing
      ? await this.prisma.profile.update({
          where: { id: existing.id },
          data: { email: body.email.toLowerCase(), fullName: body.fullName, role: body.role, jobTitle: body.jobTitle, venueId: body.venueId },
        })
      : await this.prisma.profile.create({
          data: { email: body.email.toLowerCase(), fullName: body.fullName, role: body.role, jobTitle: body.jobTitle, venueId: body.venueId },
        });
    void this.email.send({
      to: row.email,
      subject: existing ? 'Your Venue Wrangler team profile was updated' : `You were added to ${viewer.venue?.name ?? 'a Venue Wrangler team'}`,
      text: existing
        ? `Hi ${row.fullName},\n\nYour team profile for ${viewer.venue?.name ?? 'your venue'} was updated.\n\nRole: ${row.role}\nJob title: ${row.jobTitle}`
        : `Hi ${row.fullName},\n\nYou were added to ${viewer.venue?.name ?? 'a Venue Wrangler team'} as ${row.jobTitle}.\n\nCreate an account or sign in with this email address to join the team.`,
    });
    return this.mapProfile(row);
  }

  @UseGuards(AuthGuard)
  @Delete('staff/:id')
  async deactivateVenueStaff(@CurrentUser() user: AuthUser, @Param('id') staffId: string) {
    const viewer = await this.requireManagerProfile(user);
    const staff = await this.prisma.profile.findFirst({ where: { id: staffId, venueId: viewer.venueId! } });
    if (!staff) throw new NotFoundException('Staff member not found');
    await this.assertCanManageLegacyStaffTarget(viewer, staff);
    const updated = await this.prisma.profile.update({ where: { id: staff.id }, data: { venueId: null } });
    return this.mapProfile(updated);
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
    await this.requireVerifiedUser(user.sub);
    const email = body.email?.trim().toLowerCase() || null;
    const token = randomBytes(18).toString('base64url');
    const code = await this.uniqueInviteCode();
    const invite = await this.prisma.invite.create({
      data: {
        venueId: profile.venueId!,
        email,
        token,
        code,
        role: body.role === 'manager' ? 'manager' : 'staff',
        jobTitle: body.jobTitle?.trim() || 'Team Member',
        createdBy: profile.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    const inviteUrl = `venuewrangler://join?invite=${encodeURIComponent(invite.token)}`;
    const venueName = profile.venue?.name ?? 'your Venue Wrangler team';
    if (email) {
      void this.email.send({
        to: email,
        subject: `Join ${venueName}`,
        text:
          `${profile.fullName} invited you to join ${venueName}.\n\n` +
          `Open the Venue Wrangler app, choose "Join a team", and enter this code:\n\n  ${code}\n\n` +
          `Or open this link on your phone:\n${inviteUrl}\n\nThis invite expires in 7 days.`,
      });
    }
    return {
      token: invite.token,
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
    const invite = await this.findRedeemableInvite(rawCode);
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
  async joinByCode(@CurrentUser() user: AuthUser, @Body() body: JoinByCodeDto) {
    await this.requireVerifiedUser(user.sub);
    const profile = await this.getProfile(user);
    if (!profile) throw new NotFoundException('Profile not found');
    if (profile.venueId) throw new BadRequestException('You are already part of a team.');
    const verifiedEmail = await this.getVerifiedAccountEmail(user.sub);

    const updated = await this.prisma.$transaction(async (tx) => {
      const invite = await this.findRedeemableInvite(body.code, tx);
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
      return tx.profile.update({
        where: { id: profile.id },
        data: { venueId: invite.venueId, role: invite.role, jobTitle: invite.jobTitle },
        include: { venue: true },
      });
    });

    const emailVerified = await this.isEmailVerified(user.sub);
    return {
      profile: this.mapProfile(updated, emailVerified),
      venue: updated.venue ? this.mapVenue(updated.venue) : null,
    };
  }

  @UseGuards(AuthGuard)
  @Post('redeem-invite')
  async redeemInvite(@CurrentUser() user: AuthUser, @Body() body: RedeemInviteDto) {
    await this.requireVerifiedUser(user.sub);
    return this.redeemInviteForUser(user.sub, body.codeOrToken);
  }

  @UseGuards(AuthGuard)
  @Post('redeem-my-invite')
  async redeemMyInvite(@CurrentUser() user: AuthUser) {
    await this.requireVerifiedUser(user.sub);
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
      return { redeemed: false };
    }
    if (matches.length > 1) {
      throw new BadRequestException('Multiple pending invites were found for this email. Use the specific invite link from your manager.');
    }
    return this.redeemInviteForUser(user.sub, matches[0].token);
  }

  // Resolve a redeemable invite by either the short code or the long token.
  private findRedeemableInvite(codeOrToken: string, tx: Prisma.TransactionClient = this.prisma) {
    const value = codeOrToken?.trim();
    if (!value) return Promise.resolve(null);
    return tx.invite.findFirst({
      where: {
        OR: [{ code: { equals: value, mode: 'insensitive' } }, { token: value }],
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
    if (profile.venueId && isOwnerOrAdminRole(profile.role)) {
      const [ownerAdminCount, memberCount] = await Promise.all([
        this.prisma.profile.count({ where: { venueId: profile.venueId, role: { in: ['owner', 'admin'] } } }),
        this.prisma.profile.count({ where: { venueId: profile.venueId } }),
      ]);
      // A sole remaining member may delete (orphaning an empty venue is fine,
      // and App Store guideline 5.1.1(v) requires in-app account deletion).
      // Block only when other staff remain but this is the last owner/admin.
      if (ownerAdminCount <= 1 && memberCount > 1) {
        throw new ForbiddenException('Transfer venue ownership or add another admin before deleting this account');
      }
    }
    await this.prisma.$transaction([
      this.prisma.pushToken.deleteMany({ where: { profileId: profile.id } }),
      this.prisma.availability.deleteMany({ where: { profileId: profile.id } }),
      // Time entries are employer wage records (FLSA retention) — keep them.
      // Snapshot the name; deleting the profile then SetNulls the linkage.
      this.prisma.timeEntry.updateMany({
        where: { profileId: profile.id },
        data: { profileFullName: profile.fullName, isOpen: false },
      }),
      this.prisma.scheduleShift.updateMany({ where: { profileId: profile.id }, data: { profileId: null, status: 'open' } }),
      this.prisma.session.deleteMany({ where: { userId: user.sub } }),
      this.prisma.authAccount.deleteMany({ where: { userId: user.sub } }),
      this.prisma.profile.delete({ where: { id: profile.id } }),
      this.prisma.user.deleteMany({ where: { id: user.sub } }),
    ]);
    void this.email.send({
      to: deletedAccountEmail,
      subject: 'Your Venue Wrangler account was deleted',
      text: `Hi ${deletedAccountName},\n\nYour Venue Wrangler account has been deleted. Any retained time records remain available to the venue for wage and compliance records.`,
    });
    return { ok: true };
  }

  private async ensureUser(user: AuthUser) {
    // Do NOT recreate the user from token claims: a deleted account's JWT stays
    // valid until expiry, and recreating here would silently resurrect it.
    const existing = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!existing) {
      throw new UnauthorizedException('This account no longer exists. Please sign in again.');
    }
    if (user.email && user.email !== existing.email) {
      return this.prisma.user.update({ where: { id: user.sub }, data: { email: user.email } });
    }
    return existing;
  }

  private getProfile(user: AuthUser) {
    return this.prisma.profile.findFirst({
      where: { userId: user.sub },
      include: { venue: true },
    });
  }

  private async requireVenueProfile(user: AuthUser) {
    const profile = await this.getProfile(user);
    if (!profile?.venue) throw new ForbiddenException('Profile is not initialized');
    return profile;
  }

  private async requireManagerProfile(user: AuthUser) {
    const profile = await this.requireVenueProfile(user);
    if (!isAdminRole(profile.role)) throw new ForbiddenException('Not authorized');
    return profile;
  }

  private async requireBillingProfile(user: AuthUser) {
    const profile = await this.requireVenueProfile(user);
    if (!(profile.role === 'admin' || profile.role === 'owner' || profile.allAccess)) {
      throw new ForbiddenException('Not authorized');
    }
    return profile;
  }

  private async requireVerifiedUser(userId: string) {
    if (!(await this.isEmailVerified(userId))) {
      throw new ForbiddenException('Verify your email before using this feature.');
    }
  }

  private async getVerifiedAccountEmail(userId: string) {
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true },
    });
    if (!account?.email || !account.emailVerifiedAt) {
      throw new ForbiddenException('Verify your email before using this feature.');
    }
    return account.email;
  }

  private async isEmailVerified(userId: string) {
    const account: any = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    } as any);
    return Boolean(account?.emailVerifiedAt);
  }

  private async redeemInviteForUser(userId: string, codeOrToken: string) {
    const email = await this.getVerifiedAccountEmail(userId);
    const profile = await this.getProfile({ sub: userId });
    if (!profile) throw new NotFoundException('Profile not found');
    if (profile.venueId) {
      const emailVerified = await this.isEmailVerified(userId);
      return {
        redeemed: false,
        profile: this.mapProfile(profile, emailVerified),
        venue: profile.venue ? this.mapVenue(profile.venue) : null,
      };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const invite = await this.findRedeemableInvite(codeOrToken, tx);
      if (!invite) throw new BadRequestException('That invite code is invalid, used, or expired.');
      if (!invite.email) {
        throw new ForbiddenException('Ask your manager to resend this invite to your email address before joining.');
      }
      if (invite.email.toLowerCase() !== email.toLowerCase()) {
        throw new ForbiddenException('This invite was sent to a different email address.');
      }
      const claimed = await tx.invite.updateMany({
        where: { id: invite.id, usedBy: null },
        data: { usedBy: profile.id },
      });
      if (claimed.count === 0) {
        throw new BadRequestException('That invite has already been used.');
      }
      return tx.profile.update({
        where: { id: profile.id },
        data: {
          email,
          venueId: invite.venueId,
          role: invite.role,
          jobTitle: invite.jobTitle,
        },
        include: { venue: true },
      });
    });

    return {
      redeemed: true,
      profile: this.mapProfile(updated, true),
      venue: updated.venue ? this.mapVenue(updated.venue) : null,
    };
  }

  private async assertCanManageLegacyStaffTarget(
    viewer: { id: string; role: Role; allAccess: boolean; venueId: string | null },
    target: { id: string; role: Role; venueId: string | null },
  ) {
    // Editing your own profile is always allowed; the last-owner guard below
    // still prevents a sole owner from self-demoting out of access.
    if (target.id !== viewer.id && !canManageRole(viewer.role, target.role, viewer.allAccess)) {
      throw new ForbiddenException('You cannot modify this staff member');
    }
    if (isOwnerOrAdminRole(target.role)) {
      const ownerAdminCount = await this.prisma.profile.count({
        where: { venueId: viewer.venueId, role: { in: ['owner', 'admin'] } },
      });
      if (ownerAdminCount <= 1) {
        throw new ForbiddenException('You cannot remove the last owner or admin from the venue');
      }
    }
  }

  private async verifyRevenueCatEntitlement(venueId: string, productId: string, entitlementId?: string) {
    const apiKey = this.config.get<string>('REVENUECAT_API_KEY') ?? this.config.get<string>('REVENUECAT_SECRET_API_KEY');
    if (!apiKey) {
      return null;
    }

    const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(venueId)}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    });
    const json: any = await response.json().catch(() => null);
    if (!response.ok) {
      throw new BadRequestException(json?.message ?? 'Could not verify RevenueCat subscription.');
    }

    const subscriber = json?.subscriber ?? {};
    const entitlements = subscriber.entitlements ?? {};
    const subscriptions = subscriber.subscriptions ?? {};
    const matchingEntitlement = entitlementId
      ? entitlements[entitlementId]
      : Object.values(entitlements).find((entitlement: any) => entitlement?.product_identifier === productId);
    const matchingSubscription = subscriptions[productId];
    const expiresAt = parseRevenueCatDate(matchingEntitlement?.expires_date ?? matchingSubscription?.expires_date);
    const purchasedAt = parseRevenueCatDate(matchingEntitlement?.purchase_date ?? matchingSubscription?.purchase_date);
    const isActive = Boolean(matchingEntitlement || matchingSubscription) && (!expiresAt || expiresAt.getTime() > Date.now());
    if (!isActive) {
      throw new BadRequestException('No active RevenueCat entitlement found for this Apple subscription.');
    }

    return { currentPeriodStart: purchasedAt, currentPeriodEnd: expiresAt };
  }

  private mapVenue(venue: { id: string; name: string; latitude: number; longitude: number; geofenceRadiusM: number }) {
    return {
      _id: venue.id,
      id: venue.id,
      name: venue.name,
      latitude: venue.latitude,
      longitude: venue.longitude,
      geofenceRadiusM: venue.geofenceRadiusM,
      geofence_radius_m: venue.geofenceRadiusM,
    };
  }

  private mapProfile(
    profile: { id: string; email: string; fullName: string; role: Role; jobTitle: string; venueId: string | null; allAccess: boolean; trialEndsAt?: Date | null },
    emailVerified = false,
  ) {
    return {
      _id: profile.id,
      id: profile.id,
      email: profile.email,
      fullName: profile.fullName,
      full_name: profile.fullName,
      emailVerified,
      email_verified: emailVerified,
      role: profile.role,
      jobTitle: profile.jobTitle,
      job_title: profile.jobTitle,
      venueId: profile.venueId,
      venue_id: profile.venueId,
      allAccess: profile.allAccess,
      all_access: profile.allAccess,
      trialEndsAt: profile.trialEndsAt?.getTime() ?? null,
    };
  }

  private mapShift(shift: { id: string; dayIndex: number; startMinutes: number; endMinutes: number; profileId: string | null; jobTitle: string; station: string; status: string; notes: string | null }, memberName: string | null) {
    return {
      _id: shift.id,
      id: shift.id,
      dayIndex: shift.dayIndex,
      day_index: shift.dayIndex,
      dayLabel: dayLabel(shift.dayIndex),
      day_label: dayLabel(shift.dayIndex),
      startMinutes: shift.startMinutes,
      start_time: minutesToTime(shift.startMinutes),
      endMinutes: shift.endMinutes,
      end_time: minutesToTime(shift.endMinutes),
      memberId: shift.profileId,
      member_id: shift.profileId,
      memberName,
      member_name: memberName,
      jobTitle: shift.jobTitle,
      job_title: shift.jobTitle,
      station: shift.station,
      status: shift.status,
      notes: shift.notes ?? undefined,
    };
  }

  private mapClockEntry(
    entry: {
      id: string;
      profileId: string | null;
      profileFullName?: string | null;
      venueId: string;
      clockInAt: Date;
      clockOutAt: Date | null;
      clockInLat: number;
      clockInLng: number;
      clockInAccuracyM: number;
      clockInMocked: boolean;
      clockOutLat: number | null;
      clockOutLng: number | null;
      clockOutAccuracyM: number | null;
      clockOutMocked: boolean | null;
      isOpen: boolean;
    },
    // Null when the staff member deleted their account; wage records are
    // retained with a snapshotted name (entry.profileFullName).
    profile: { fullName: string; role: Role; jobTitle: string } | null,
    venue: { name: string },
  ) {
    const memberName = profile?.fullName ?? entry.profileFullName ?? 'Former staff';
    const role = profile?.role ?? 'staff';
    const jobTitle = profile?.jobTitle ?? 'Former staff';
    return {
      _id: entry.id,
      id: entry.id,
      memberId: entry.profileId,
      member_id: entry.profileId,
      memberName,
      member_name: memberName,
      role,
      jobTitle,
      job_title: jobTitle,
      venueId: entry.venueId,
      venue_id: entry.venueId,
      venueName: venue.name,
      venue_name: venue.name,
      clockInAt: entry.clockInAt.getTime(),
      clock_in_at: entry.clockInAt.getTime(),
      clockOutAt: toMs(entry.clockOutAt),
      clock_out_at: toMs(entry.clockOutAt),
      clockInLat: entry.clockInLat,
      clock_in_lat: entry.clockInLat,
      clockInLng: entry.clockInLng,
      clock_in_lng: entry.clockInLng,
      clockInAccuracyM: entry.clockInAccuracyM,
      clock_in_accuracy_m: entry.clockInAccuracyM,
      clockInMocked: entry.clockInMocked,
      clock_in_mocked: entry.clockInMocked,
      clockOutLat: entry.clockOutLat,
      clock_out_lat: entry.clockOutLat,
      clockOutLng: entry.clockOutLng,
      clock_out_lng: entry.clockOutLng,
      clockOutAccuracyM: entry.clockOutAccuracyM,
      clock_out_accuracy_m: entry.clockOutAccuracyM,
      clockOutMocked: entry.clockOutMocked,
      clock_out_mocked: entry.clockOutMocked,
      isOpen: entry.isOpen,
      is_open: entry.isOpen,
    };
  }
}

function parseRevenueCatDate(value: unknown) {
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
