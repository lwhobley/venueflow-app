import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { isAdminRole } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.guard';

type Scope = VenueScopedRequest['venueScope'];

@Controller('v1/notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @RequireSubscription()
  @Get()
  async list(@VenueScope() scope: Scope) {
    if (!scope) return [];

    const rows = await this.prisma.notificationEvent.findMany({
      where: { venueId: scope.venueId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const visible = rows.filter((row) => {
      if (row.audience === 'profile') return row.profileId === scope.profileId;
      if (row.audience === 'managers') return isAdminRole(scope.role);
      return row.audience === 'staff';
    });

    if (visible.length === 0) return [];

    const reads = await this.prisma.notificationRead.findMany({
      where: {
        profileId: scope.profileId,
        notificationId: { in: visible.map((row) => row.id) },
      },
    });
    const readMap = new Map(reads.map((r) => [r.notificationId, r.readAt]));

    return visible.map((row) => ({
      _id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      audience: row.audience,
      profileId: row.profileId,
      createdAt: row.createdAt.getTime(),
      readAt: readMap.get(row.id)?.getTime() ?? null,
    }));
  }

  @RequireSubscription()
  @Post(':id/read')
  async markRead(@VenueScope() scope: Scope, @Param('id') id: string) {
    if (!scope) throw new BadRequestException('Profile is not initialized');

    const row = await this.prisma.notificationEvent.findUnique({ where: { id } });
    if (!row || row.venueId !== scope.venueId) {
      throw new NotFoundException('Notification not found');
    }

    const canRead =
      row.audience === 'staff' ||
      (row.audience === 'managers' && isAdminRole(scope.role)) ||
      (row.audience === 'profile' && row.profileId === scope.profileId);
    if (!canRead) throw new ForbiddenException('Not authorized');

    await this.prisma.notificationRead.upsert({
      where: {
        notificationId_profileId: {
          notificationId: row.id,
          profileId: scope.profileId,
        },
      },
      create: {
        notificationId: row.id,
        profileId: scope.profileId,
        venueId: scope.venueId,
      },
      update: {},
    });

    return { ok: true };
  }
}
