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
      const isDemoting = isOwnerOrAdminRole(existing.role) && !isOwnerOrAdminRole(body.role);
      await this.assertCanManageLegacyStaffTarget(viewer, existing, isDemoting);
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
    const venueName = viewer.venue?.name ?? 'your venue';
    void this.email.send({
      to: row.email,
      subject: existing ? 'Your Venue Wrangler Profile Has Been Updated' : `Invitation: Join the Team at ${venueName} on Venue Wrangler`,
      text: existing
        ? `Hi ${row.fullName},\n\n` +
          `Your team profile for ${venueName} was updated. Here are your current profile details:\n\n` +
          `Updated Profile Details\n` +
          `Detail\tInfo\n` +
          `Name\t${row.fullName}\n` +
          `Role\t${row.role}\n` +
          `Job Title\t${row.jobTitle}\n\n` +
          `If you did not request these changes or have any questions, please contact your venue administrator.\n\n` +
          `Questions? support@venuewrangler.com\n\n` +
          `— The Venue Wrangler Team`
        : `Hi ${row.fullName},\n\n` +
          `Welcome! You have been added to the team at ${venueName} as a ${row.jobTitle}.\n\n` +
          `To view your schedule, manage your availability, and request shift swaps, please join the venue using the steps below:\n\n` +
          `1. Create a Venue Wrangler account or sign in using your email: ${row.email}\n` +
          `2. You will be automatically linked to the venue and can access your dashboard right away.\n\n` +
          `We're excited to have you on board!\n\n` +
          `Questions? support@venuewrangler.com\n\n` +
          `— The Venue Wrangler Team`,
    });
    return mapProfile(row);
  }

  @UseGuards(AuthGuard)
  @Delete('staff/:id')
  async deactivateVenueStaff(@CurrentUser() user: AuthUser, @Param('id') staffId: string) {
    const viewer = await this.profiles.requireManagerProfile(user);
    const staff = await this.prisma.profile.findFirst({ where: { id: staffId, venueId: viewer.venueId! } });
    if (!staff) throw new NotFoundException('Staff member not found');
    await this.assertCanManageLegacyStaffTarget(viewer, staff, true);
    const updated = await this.prisma.profile.update({ where: { id: staff.id }, data: { venueId: null } });
    return mapProfile(updated);
  }

  private async assertCanManageLegacyStaffTarget(
    viewer: { id: string; role: Role; allAccess: boolean; venueId: string | null },
    target: { id: string; role: Role; venueId: string | null },
    demotingOrRemoving = false,
  ) {
    // Editing your own profile is always allowed; the last-owner guard below
    // still prevents a sole owner from self-demoting out of access.
    if (target.id !== viewer.id && !canManageRole(viewer.role, target.role, viewer.allAccess)) {
      throw new ForbiddenException('You cannot modify this staff member');
    }
    // Only enforce the last-owner/admin guard when the operation would actually
    // remove or demote the target. Harmless edits (name, phone, job title) on
    // the sole owner/admin are safe and should not be blocked.
    if (demotingOrRemoving && isOwnerOrAdminRole(target.role)) {
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
