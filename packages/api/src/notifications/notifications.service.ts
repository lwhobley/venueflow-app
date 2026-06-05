import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Writes NotificationEvent rows. Mirrors notifyManagers / notifyProfile in
 * convex/app.ts. Visibility is enforced at read time via the `audience` field.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async notifyManagers(args: { venueId: string; kind: string; title: string; body: string }) {
    await this.prisma.notificationEvent.create({
      data: {
        venueId: args.venueId,
        audience: 'managers',
        kind: args.kind,
        title: args.title,
        body: args.body,
      },
    });
  }

  async notifyProfile(args: {
    venueId: string;
    profileId: string;
    kind: string;
    title: string;
    body: string;
  }) {
    await this.prisma.notificationEvent.create({
      data: {
        venueId: args.venueId,
        profileId: args.profileId,
        audience: 'profile',
        kind: args.kind,
        title: args.title,
        body: args.body,
      },
    });
  }

  async notifyStaff(args: { venueId: string; kind: string; title: string; body: string }) {
    await this.prisma.notificationEvent.create({
      data: {
        venueId: args.venueId,
        audience: 'staff',
        kind: args.kind,
        title: args.title,
        body: args.body,
      },
    });
  }
}
