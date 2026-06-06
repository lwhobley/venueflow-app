import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { IsString } from 'class-validator';
import { isAdminRole } from '../../auth/roles';
import { mapVenueRole } from '../../common/mappers';
import { PrismaService } from '../../prisma/prisma.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.guard';

type Scope = VenueScopedRequest['venueScope'];

class CreateVenueRoleDto {
  @IsString()
  name!: string;
}

@Controller('v1/venue-roles')
export class VenueRolesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listVenueRoles(@VenueScope() scope: Scope) {
    if (!scope) return [];
    const rows = await this.prisma.venueRole.findMany({
      where: { venueId: scope.venueId },
    });
    return rows
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(mapVenueRole);
  }

  @Post()
  async addVenueRole(@VenueScope() scope: Scope, @Body() body: CreateVenueRoleDto) {
    if (!scope || !isAdminRole(scope.role)) {
      throw new ForbiddenException('Not authorized');
    }
    const name = body.name.trim();
    if (!name) throw new BadRequestException('Enter a role name');

    const existing = await this.prisma.venueRole.findMany({
      where: { venueId: scope.venueId },
    });
    if (existing.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
      throw new BadRequestException('That role already exists');
    }

    const created = await this.prisma.venueRole.create({
      data: { venueId: scope.venueId, name },
    });
    return mapVenueRole(created);
  }

  @Delete(':id')
  async removeVenueRole(@VenueScope() scope: Scope, @Param('id') id: string) {
    if (!scope || !isAdminRole(scope.role)) {
      throw new ForbiddenException('Not authorized');
    }
    const row = await this.prisma.venueRole.findUnique({ where: { id } });
    if (!row || row.venueId !== scope.venueId) {
      throw new NotFoundException('Role not found');
    }
    await this.prisma.venueRole.delete({ where: { id: row.id } });
    return { _id: row.id };
  }
}
