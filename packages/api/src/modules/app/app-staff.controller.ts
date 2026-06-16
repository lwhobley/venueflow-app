import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { IsArray, IsDateString, IsEmail, IsIn, IsOptional, IsString } from 'class-validator';
import { Role } from '@prisma/client';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../auth/auth.guard';
import { canManageRole, isOwnerOrAdminRole } from '../../auth/roles';
import { EmailService } from '../../email/email.service';
import { PrismaService } from '../../prisma/prisma.service';
import { mapProfile } from './app-mappers';
import { ProfileService } from './profile.service';

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

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  altPhone?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsDateString()
  @IsOptional()
  dateOfBirth?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  certifications?: string[];
}

// Venue-staff roster CRUD for /v1/app/staff*. Split out of AppController;
// routes, role checks, and response shapes are unchanged.
@Controller('v1/app')
export class AppStaffController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly profiles: ProfileService,
  ) {}

  @UseGuards(AuthGuard)
  @Get('staff')
  async listVenueStaff(@CurrentUser() user: AuthUser) {
    const profile = await this.profiles.requireManagerProfile(user);
    return this.prisma.profile
      .findMany({ where: { venueId: profile.venueId! }, orderBy: { fullName: 'asc' } })
      .then((rows) => rows.map((row) => mapProfile(row)));
  }

  @UseGuards(AuthGuard)
  @Post('staff')
  async upsertVenueStaff(@CurrentUser() user: AuthUser, @Body() body: StaffDto) {
    const viewer = await this.profiles.requireManagerProfile(user);
    if (viewer.venueId !== body.venueId) throw new ForbiddenException('Not authorized');
    const viewerIsOwnerOrAdmin = viewer.role === 'owner' || viewer.role === 'admin' || viewer.allAccess;
    if (!viewerIsOwnerOrAdmin && ['admin', 'owner', 'manager'].includes(body.role)) {
      throw new ForbiddenException('Managers cannot assign admin, owner, or manager roles');
    }
    const existing = await this.prisma.profile.findFirst({ where: { venueId: body.venueId, email: body.email.toLowerCase() } });
    if (existing) {
      await this.assertCanManageLegacyStaffTarget(viewer, existing);
    }
    const employeeFields = {
      phone: body.phone?.trim() || null,
      altPhone: body.altPhone?.trim() || null,
      address: body.address?.trim() || null,
      dateOfBirth: body.dateOfBirth ? parseDateOfBirth(body.dateOfBirth) : null,
      certifications: body.certifications ?? [],
    };
    const row = existing
      ? await this.prisma.profile.update({
          where: { id: existing.id },
          data: { email: body.email.toLowerCase(), fullName: body.fullName, role: body.role, jobTitle: body.jobTitle, venueId: body.venueId, ...employeeFields },
        })
      : await this.prisma.profile.create({
          data: { email: body.email.toLowerCase(), fullName: body.fullName, role: body.role, jobTitle: body.jobTitle, venueId: body.venueId, ...employeeFields },
        });
    void this.email.send({
      to: row.email,
      subject: existing ? 'Your Venue Wrangler team profile was updated' : `You were added to ${viewer.venue?.name ?? 'a Venue Wrangler team'}`,
      text: existing
        ? `Hi ${row.fullName},\n\nYour team profile for ${viewer.venue?.name ?? 'your venue'} was updated.\n\nRole: ${row.role}\nJob title: ${row.jobTitle}`
        : `Hi ${row.fullName},\n\nYou were added to ${viewer.venue?.name ?? 'a Venue Wrangler team'} as ${row.jobTitle}.\n\nCreate an account or sign in with this email address to join the team.`,
    });
    return mapProfile(row);
  }

  @UseGuards(AuthGuard)
  @Delete('staff/:id')
  async deactivateVenueStaff(@CurrentUser() user: AuthUser, @Param('id') staffId: string) {
    const viewer = await this.profiles.requireManagerProfile(user);
    const staff = await this.prisma.profile.findFirst({ where: { id: staffId, venueId: viewer.venueId! } });
    if (!staff) throw new NotFoundException('Staff member not found');
    await this.assertCanManageLegacyStaffTarget(viewer, staff);
    const updated = await this.prisma.profile.update({ where: { id: staff.id }, data: { venueId: null } });
    return mapProfile(updated);
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
}

/** Accept only YYYY-MM-DD and store as noon UTC to avoid timezone day-shift. */
function parseDateOfBirth(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException('dateOfBirth must be in YYYY-MM-DD format.');
  }
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('dateOfBirth is not a valid date.');
  }
  return date;
}
