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
import { isAdminRole } from '../../auth/roles';
import { mapProfile } from '../../common/mappers';
import { PrismaService } from '../../prisma/prisma.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.guard';

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

    const member = await this.prisma.profile.findFirst({
      where: { venueId: scope.venueId, email: { equals: body.email, mode: 'insensitive' } },
    });

    if (member) {
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

    const updated = await this.prisma.profile.update({
      where: { id: staff.id },
      data: { venueId: null },
    });
    return mapProfile(updated);
  }
}
