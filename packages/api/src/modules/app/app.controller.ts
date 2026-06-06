import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsEmail, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Role } from '@prisma/client';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../auth/auth.guard';
import { PrismaService } from '../../prisma/prisma.service';

const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
const STAFF_RANGES = ['1-15', '16-30', '31-50'] as const;

class BootstrapProfileDto {
  @IsEmail()
  @IsOptional()
  email?: string;

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
  @IsOptional()
  latitude?: number;

  @IsNumber()
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

function isAdminRole(role: Role) {
  return role === 'admin' || role === 'owner' || role === 'manager';
}

function planForStaffRange(range: string) {
  if (range === '16-30') return { planId: 'venueflow_growth_30_monthly', priceCents: 14999 };
  if (range === '31-50') return { planId: 'venueflow_pro_50_monthly', priceCents: 29999 };
  return { planId: 'venueflow_starter_15_monthly', priceCents: 7999 };
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

function assertWithinGeofence(lat: number, lng: number, accuracy: number, mocked: boolean, venue: { latitude: number; longitude: number; geofenceRadiusM: number }) {
  if (mocked) throw new Error('Mocked locations are not allowed.');
  if (accuracy > 50) throw new Error('Location accuracy must be 50m or better.');
  const earthRadius = 6371000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLat = toRadians(lat - venue.latitude);
  const deltaLng = toRadians(lng - venue.longitude);
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(toRadians(venue.latitude)) * Math.cos(toRadians(lat)) * Math.sin(deltaLng / 2) ** 2;
  const distance = 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(a)));
  if (distance > venue.geofenceRadiusM) {
    throw new Error('You are outside the venue geofence.');
  }
}

@Controller('v1/app')
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @UseGuards(AuthGuard)
  @Get('me')
  async getMe(@CurrentUser() user: AuthUser) {
    const profile = await this.getProfile(user);
    if (!profile) return null;
    return { profile: this.mapProfile(profile), venue: profile.venue ? this.mapVenue(profile.venue) : null };
  }

  @UseGuards(AuthGuard)
  @Post('bootstrap-profile')
  async bootstrapProfile(@CurrentUser() user: AuthUser, @Body() body: BootstrapProfileDto) {
    await this.ensureUser(user);
    const email = body.email ?? user.email ?? `${user.sub}@venuewrangler.local`;
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

    return { profile: this.mapProfile(profile), venue: profile.venue ? this.mapVenue(profile.venue) : null };
  }

  @UseGuards(AuthGuard)
  @Post('register-venue')
  async registerVenue(@CurrentUser() user: AuthUser, @Body() body: RegisterVenueDto) {
    await this.ensureUser(user);
    const businessName = body.businessName.trim();
    if (!businessName) throw new Error('Enter your business name');
    if (body.staffRange === '50+') throw new Error('For 50+ staff, please contact admin@venuewrangler.com to set up your account.');
    if (!STAFF_RANGES.includes(body.staffRange as (typeof STAFF_RANGES)[number])) throw new Error('Choose a staff size range');

    const existingProfile = await this.getProfile(user);
    if (existingProfile?.venue) {
      return { profile: this.mapProfile(existingProfile), venue: this.mapVenue(existingProfile.venue) };
    }

    const plan = planForStaffRange(body.staffRange);
    const trialStartedAt = new Date();
    const trialEndsAt = new Date(trialStartedAt.getTime() + TRIAL_DURATION_MS);
    const result = await this.prisma.$transaction(async (tx) => {
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
  @Get('dashboard')
  async getDashboard(@CurrentUser() user: AuthUser) {
    const profile = await this.getProfile(user);
    if (!profile?.venue) return null;
    const canManage = isAdminRole(profile.role);
    const shifts = await this.prisma.scheduleShift.findMany({
      where: {
        venueId: profile.venueId!,
        ...(canManage ? {} : { OR: [{ profileId: profile.id }, { status: 'open' }] }),
      },
      include: { profile: true },
      orderBy: [{ dayIndex: 'asc' }, { startMinutes: 'asc' }],
      take: 50,
    });
    const [teamCount, activeEntries] = await Promise.all([
      canManage ? this.prisma.profile.count({ where: { venueId: profile.venueId! } }) : Promise.resolve(0),
      canManage
        ? this.prisma.timeEntry.findMany({
            where: { venueId: profile.venueId!, isOpen: true },
            include: { profile: true, venue: true },
            take: 50,
          })
        : Promise.resolve([]),
    ]);

    return {
      profile: this.mapProfile(profile),
      venue: this.mapVenue(profile.venue),
      analytics: {
        teamCount,
        scheduledCount: shifts.filter((shift) => shift.status === 'scheduled').length,
        openShiftCount: shifts.filter((shift) => shift.status === 'open').length,
        coveredShiftCount: shifts.filter((shift) => shift.status === 'covered').length,
        openClockCount: activeEntries.length,
        clockedInCount: activeEntries.length,
      },
      schedule: shifts.slice(0, 14).map((shift) => this.mapShift(shift, canManage ? shift.profile?.fullName ?? null : shift.profileId === profile.id ? 'You' : null)),
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
          e.id,
          e.profileId,
          `"${e.profile.fullName.replace(/"/g, '""')}"`,
          e.clockInAt.toISOString(),
          e.clockOutAt?.toISOString() ?? '',
          hours,
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
    if (!profile?.venueId) throw new Error('Profile is not initialized');
    const row = await this.prisma.notificationEvent.findFirst({ where: { id: notificationId, venueId: profile.venueId } });
    if (!row) throw new NotFoundException('Notification not found');
    const canRead = row.audience === 'staff' || (row.audience === 'managers' && isAdminRole(profile.role)) || (row.audience === 'profile' && row.profileId === profile.id);
    if (!canRead) throw new Error('Not authorized');
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
    if (!venue) throw new Error('Assigned venue not found');
    assertWithinGeofence(body.lat, body.lng, body.accuracy, body.mocked, venue);
    const existing = await this.prisma.timeEntry.findFirst({ where: { profileId: profile.id, isOpen: true } });
    if (existing) throw new Error('Already clocked in');
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
  }

  @UseGuards(AuthGuard)
  @Post('clock-out')
  async clockOut(@CurrentUser() user: AuthUser, @Body() body: ClockDto) {
    const profile = await this.requireVenueProfile(user);
    const venue = profile.venue;
    if (!venue) throw new Error('Assigned venue not found');
    assertWithinGeofence(body.lat, body.lng, body.accuracy, body.mocked, venue);
    const existing = await this.prisma.timeEntry.findFirst({ where: { profileId: profile.id, isOpen: true } });
    if (!existing) throw new Error('No active clock-in found');
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
    if (viewer.venueId !== body.venueId) throw new Error('Not authorized');
    const viewerIsOwnerOrAdmin = viewer.role === 'owner' || viewer.role === 'admin' || viewer.allAccess;
    if (!viewerIsOwnerOrAdmin && ['admin', 'owner', 'manager'].includes(body.role)) {
      throw new Error('Managers cannot assign admin, owner, or manager roles');
    }
    const existing = await this.prisma.profile.findFirst({ where: { venueId: body.venueId, email: body.email.toLowerCase() } });
    const row = existing
      ? await this.prisma.profile.update({
          where: { id: existing.id },
          data: { email: body.email.toLowerCase(), fullName: body.fullName, role: body.role, jobTitle: body.jobTitle, venueId: body.venueId },
        })
      : await this.prisma.profile.create({
          data: { email: body.email.toLowerCase(), fullName: body.fullName, role: body.role, jobTitle: body.jobTitle, venueId: body.venueId },
        });
    return this.mapProfile(row);
  }

  @UseGuards(AuthGuard)
  @Delete('staff/:id')
  async deactivateVenueStaff(@CurrentUser() user: AuthUser, @Param('id') staffId: string) {
    const viewer = await this.requireManagerProfile(user);
    const staff = await this.prisma.profile.findFirst({ where: { id: staffId, venueId: viewer.venueId! } });
    if (!staff) throw new NotFoundException('Staff member not found');
    const updated = await this.prisma.profile.update({ where: { id: staff.id }, data: { venueId: null } });
    return this.mapProfile(updated);
  }

  @UseGuards(AuthGuard)
  @Delete('me')
  async deleteMyAccount(@CurrentUser() user: AuthUser) {
    const profile = await this.getProfile(user);
    if (!profile) return { ok: true };
    await this.prisma.$transaction([
      this.prisma.pushToken.deleteMany({ where: { profileId: profile.id } }),
      this.prisma.availability.deleteMany({ where: { profileId: profile.id } }),
      this.prisma.timeEntry.deleteMany({ where: { profileId: profile.id } }),
      this.prisma.scheduleShift.updateMany({ where: { profileId: profile.id }, data: { profileId: null, status: 'open' } }),
      this.prisma.session.deleteMany({ where: { userId: user.sub } }),
      this.prisma.authAccount.deleteMany({ where: { userId: user.sub } }),
      this.prisma.profile.delete({ where: { id: profile.id } }),
      this.prisma.user.deleteMany({ where: { id: user.sub } }),
    ]);
    return { ok: true };
  }

  private async ensureUser(user: AuthUser) {
    return this.prisma.user.upsert({
      where: { id: user.sub },
      update: { email: user.email ?? undefined },
      create: { id: user.sub, email: user.email ?? null },
    });
  }

  private getProfile(user: AuthUser) {
    return this.prisma.profile.findFirst({ where: { userId: user.sub }, include: { venue: true } });
  }

  private async requireVenueProfile(user: AuthUser) {
    const profile = await this.getProfile(user);
    if (!profile?.venue) throw new Error('Profile is not initialized');
    return profile;
  }

  private async requireManagerProfile(user: AuthUser) {
    const profile = await this.requireVenueProfile(user);
    if (!isAdminRole(profile.role)) throw new Error('Not authorized');
    return profile;
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

  private mapProfile(profile: { id: string; email: string; fullName: string; role: Role; jobTitle: string; venueId: string | null; allAccess: boolean }) {
    return {
      _id: profile.id,
      id: profile.id,
      email: profile.email,
      fullName: profile.fullName,
      full_name: profile.fullName,
      role: profile.role,
      jobTitle: profile.jobTitle,
      job_title: profile.jobTitle,
      venueId: profile.venueId,
      venue_id: profile.venueId,
      allAccess: profile.allAccess,
      all_access: profile.allAccess,
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
      profileId: string;
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
    profile: { fullName: string; role: Role; jobTitle: string },
    venue: { name: string },
  ) {
    return {
      _id: entry.id,
      id: entry.id,
      memberId: entry.profileId,
      member_id: entry.profileId,
      memberName: profile.fullName,
      member_name: profile.fullName,
      role: profile.role,
      jobTitle: profile.jobTitle,
      job_title: profile.jobTitle,
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
