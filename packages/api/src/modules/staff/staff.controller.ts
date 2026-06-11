import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { IsEmail, IsIn, IsString } from 'class-validator';
import { Role } from '@prisma/client';
import { canManageRole, isAdminRole, isOwnerOrAdminRole } from '../../auth/roles';
import { mapProfile } from '../../common/mappers';
import { PrismaService } from '../../prisma/prisma.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';

type Scope = VenueScopedRequest['venueScope'];

const ROLES = ['admin', 'owner', 'manager', 'server', 'staff'];
const ELEVATED_ROLES = ['admin', 'owner', 'manager'];

class UpsertStaffDto {
  @IsEmail()
  email!: string;

  @IsString()
  fullName!: string;

  @IsString()
  @IsIn(ROLES)
  role!: string;

  @IsString()
  jobTitle!: string;
}

@Controller('v1/staff')
export class StaffController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listVenueStaff(@VenueScope() scope: Scope) {
    if (!scope || !isAdminRole(scope.role)) return [];
    const staff = await this.prisma.profile.findMany({
      where: { venueId: scope.venueId },
    });
    return staff
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .map(mapProfile);
  }

  @Post()
  async upsertVenueStaff(@VenueScope() scope: Scope, @Body() body: UpsertStaffDto) {
    if (!scope || !isAdminRole(scope.role)) {
      throw new ForbiddenException('Not authorized');
    }

    // Managers cannot grant roles at or above their own level.
    const viewerIsOwnerOrAdmin =
      scope.role === 'owner' || scope.role === 'admin' || scope.allAccess;
    if (!viewerIsOwnerOrAdmin && ELEVATED_ROLES.includes(body.role)) {
      throw new ForbiddenException('Managers cannot assign admin, owner, or manager roles');
    }

    const existing = await this.prisma.profile.findMany({ where: { venueId: scope.venueId } });
    const member =
      existing.find((item) => item.email.toLowerCase() === body.email.toLowerCase()) ?? null;

    if (member) {
      await this.assertCanManageTarget(scope, member);
      const updated = await this.prisma.profile.update({
        where: { id: member.id },
        data: {
          email: body.email,
          fullName: body.fullName,
          role: body.role as Role,
          jobTitle: body.jobTitle,
          venueId: scope.venueId,
        },
      });
      return mapProfile(updated);
    }

    const created = await this.prisma.profile.create({
      data: {
        tokenIdentifier: `${body.email.toLowerCase()}:invited:${Date.now()}`,
        email: body.email.toLowerCase(),
        fullName: body.fullName,
        role: body.role as Role,
        jobTitle: body.jobTitle,
        venueId: scope.venueId,
      },
    });
    return mapProfile(created);
  }

  @Delete(':id')
  async deactivateVenueStaff(@VenueScope() scope: Scope, @Param('id') id: string) {
    if (!scope || !isAdminRole(scope.role)) {
      throw new ForbiddenException('Not authorized');
    }

    const staff = await this.prisma.profile.findUnique({ where: { id } });
    if (!staff) throw new NotFoundException('Staff member not found');
    if (staff.venueId !== scope.venueId) {
      throw new ForbiddenException('Staff member does not belong to this venue');
    }
    await this.assertCanManageTarget(scope, staff);

    const updated = await this.prisma.profile.update({
      where: { id: staff.id },
      data: { venueId: null },
    });
    return mapProfile(updated);
  }

  private async assertCanManageTarget(
    scope: NonNullable<Scope>,
    target: { id: string; role: Role; venueId: string | null },
  ) {
    // Editing your own profile is always allowed; the last-owner guard below
    // still prevents a sole owner from self-demoting out of access.
    if (target.id !== scope.profileId && !canManageRole(scope.role, target.role, scope.allAccess)) {
      throw new ForbiddenException('You cannot modify this staff member');
    }
    if (isOwnerOrAdminRole(target.role)) {
      const ownerAdminCount = await this.prisma.profile.count({
        where: { venueId: scope.venueId, role: { in: ['owner', 'admin'] } },
      });
      if (ownerAdminCount <= 1) {
        throw new ForbiddenException('You cannot remove the last owner or admin from the venue');
      }
    }
  }
}
