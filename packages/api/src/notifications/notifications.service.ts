import { Injectable, Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const ADMIN_ROLES: Role[] = [Role.admin, Role.owner, Role.manager];
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_CHUNK_SIZE = 100;

/**
 * Writes NotificationEvent rows and delivers them to registered devices via the
 * Expo push service. In-app visibility is enforced at read time via `audience`;
 * push delivery resolves the audience to the matching PushToken rows.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');

  constructor(private readonly prisma: PrismaService) {}

  async notifyManagers(args: { venueId: string; kind: string; title: string; body: string }) {
    await this.prisma.notificationEvent.create({
      data: { venueId: args.venueId, audience: 'managers', kind: args.kind, title: args.title, body: args.body },
    });
    const managers = await this.prisma.profile.findMany({
      where: { venueId: args.venueId, role: { in: ADMIN_ROLES } },
      select: { id: true },
    });
    await this.deliver({ venueId: args.venueId, profileIds: managers.map((m) => m.id), title: args.title, body: args.body, kind: args.kind });
  }

  async notifyProfile(args: { venueId: string; profileId: string; kind: string; title: string; body: string }) {
    await this.prisma.notificationEvent.create({
      data: { venueId: args.venueId, profileId: args.profileId, audience: 'profile', kind: args.kind, title: args.title, body: args.body },
    });
    await this.deliver({ venueId: args.venueId, profileIds: [args.profileId], title: args.title, body: args.body, kind: args.kind });
  }

  async notifyStaff(args: { venueId: string; kind: string; title: string; body: string }) {
    await this.prisma.notificationEvent.create({
      data: { venueId: args.venueId, audience: 'staff', kind: args.kind, title: args.title, body: args.body },
    });
    await this.deliver({ venueId: args.venueId, title: args.title, body: args.body, kind: args.kind });
  }

  /**
   * Sends an Expo push to the venue's enabled device tokens. When `profileIds`
   * is omitted, every enabled token in the venue is targeted (staff broadcast).
   * Best-effort: delivery failures are logged, never thrown to the caller.
   */
  private async deliver(args: {
    venueId: string;
    profileIds?: string[];
    title: string;
    body: string;
    kind: string;
  }) {
    try {
      if (args.profileIds && args.profileIds.length === 0) return;
      const tokens = await this.prisma.pushToken.findMany({
        where: {
          venueId: args.venueId,
          enabled: true,
          ...(args.profileIds ? { profileId: { in: args.profileIds } } : {}),
        },
        select: { token: true },
      });
      if (tokens.length === 0) return;

      const messages = tokens.map((t) => ({
        to: t.token,
        title: args.title,
        body: args.body,
        data: { kind: args.kind },
        sound: 'default' as const,
      }));

      for (let i = 0; i < messages.length; i += EXPO_CHUNK_SIZE) {
        const chunk = messages.slice(i, i + EXPO_CHUNK_SIZE);
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(chunk),
        });
        if (!res.ok) {
          this.logger.warn(`Expo push failed (${res.status}) for ${chunk.length} tokens`);
          continue;
        }
        const json = (await res.json().catch(() => null)) as
          | { data?: Array<{ status?: string; details?: { error?: string } }> }
          | null;
        await this.disableUnregistered(json, chunk.map((m) => m.to));
      }
    } catch (error) {
      this.logger.warn(`Push delivery error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Disable tokens Expo reports as unregistered so we stop sending to dead devices.
  private async disableUnregistered(
    json: { data?: Array<{ status?: string; details?: { error?: string } }> } | null,
    tokens: string[],
  ) {
    if (!json?.data) return;
    const dead: string[] = [];
    json.data.forEach((receipt, idx) => {
      if (receipt?.status === 'error' && receipt.details?.error === 'DeviceNotRegistered' && tokens[idx]) {
        dead.push(tokens[idx]);
      }
    });
    if (dead.length > 0) {
      await this.prisma.pushToken.updateMany({ where: { token: { in: dead } }, data: { enabled: false } });
    }
  }
}
