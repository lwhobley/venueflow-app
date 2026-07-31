import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  Patch,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { isAdminRole } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { Public } from '../../auth/public.decorator';
import { SkipVenueScope } from '../../venue/skip-venue-scope.decorator';
import { ALLOWED_IMAGE_MIME, assertAllowedImageBytes } from '../../common/image-bytes';
import { PrismaService } from '../../prisma/prisma.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { MediaAccessService } from './media-access.service';
import { S3ImageService } from './s3-image.service';

// Chat photo uploads. Kept small — images are picker-compressed (quality 0.5)
// before they reach us; reject anything larger so the DB store stays lean.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type Scope = VenueScopedRequest['venueScope'];

const GENERAL_GROUP_NAME = 'All Staff';

class OpenDmDto {
  @IsString()
  targetProfileId!: string;
}

class CreateGroupDto {
  @IsString()
  name!: string;

  @IsArray()
  @IsString({ each: true })
  memberIds!: string[];
}

class SendMessageDto {
  @IsString()
  text!: string;

  @IsString()
  @IsOptional()
  shiftId?: string;

  @IsString()
  @IsOptional()
  swapId?: string;

  @IsString()
  @IsOptional()
  imageUrl?: string;
}

class ReactDto {
  @IsString()
  emoji!: string;
}

class EditMessageDto {
  @IsString()
  text!: string;
}

class UploadImageDto {
  // Base64-encoded image bytes (no data: prefix), as produced by expo-image-picker.
  @IsString()
  dataBase64!: string;

  @IsString()
  @IsIn(ALLOWED_IMAGE_MIME)
  mimeType!: string;
}

function requireManager(scope: Scope): asserts scope is NonNullable<Scope> {
  if (!scope || !isAdminRole(scope.role)) throw new ForbiddenException('Not authorized');
}

@Controller('v1/chat')
export class ChatController {
  // Per-process throttle so listConversations (called on every chat screen
  // open/refresh) doesn't re-run the full role/crew sync — with its per-role
  // and per-day create/update writes — on every single request. Roster and
  // schedule changes aren't second-to-second, so a short debounce is enough;
  // worst case each replica re-syncs independently on its own cadence, which
  // is still far less write amplification than per-request.
  private readonly lastContextualSyncAt = new Map<string, number>();
  private static readonly CONTEXTUAL_SYNC_THROTTLE_MS = 5 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaAccess: MediaAccessService,
    private readonly s3ImageService: S3ImageService,
  ) {}

  private async ensureContextualConversationsThrottled(venueId: string) {
    const lastSync = this.lastContextualSyncAt.get(venueId);
    if (lastSync && Date.now() - lastSync < ChatController.CONTEXTUAL_SYNC_THROTTLE_MS) {
      return;
    }
    this.lastContextualSyncAt.set(venueId, Date.now());
    await this.ensureContextualConversations(venueId);
  }

  async ensureContextualConversations(venueId: string) {
    const [profiles, allShifts, existingConvs] = await Promise.all([
      this.prisma.profile.findMany({
        where: { venueId },
        select: { id: true, jobTitle: true, role: true, allAccess: true },
      }),
      this.prisma.scheduleShift.findMany({
        where: { venueId },
        select: { profileId: true, dayIndex: true },
      }),
      this.prisma.conversation.findMany({
        where: { venueId, type: { in: ['role', 'shift'] } },
      }),
    ]);

    const managerIds = profiles.filter((p) => isAdminRole(p.role) || p.allAccess).map((p) => p.id);

    // Group existing by roleName/shiftDate
    const existingRolesMap = new Map(existingConvs.filter((c) => c.type === 'role' && c.roleName).map((c) => [c.roleName!, c]));
    const existingShiftsMap = new Map(existingConvs.filter((c) => c.type === 'shift' && c.shiftDate).map((c) => [c.shiftDate!, c]));

    const helperArraysEqual = (a: string[], b: string[]) => {
      if (a.length !== b.length) return false;
      const setA = new Set(a);
      return b.every((x) => setA.has(x));
    };

    // 1. Ensure Role Channels
    const roles = Array.from(new Set(profiles.map((p) => p.jobTitle || p.role).filter(Boolean)));
    for (const role of roles) {
      const roleMemberIds = Array.from(new Set([
        ...managerIds,
        ...profiles.filter((p) => p.jobTitle === role || p.role === role).map((p) => p.id)
      ])).sort();
      
      const existing = existingRolesMap.get(role);
      const name = `#Role - ${role}`;
      if (!existing) {
        await this.prisma.conversation.create({
          data: {
            venueId,
            type: 'role',
            roleName: role,
            name,
            memberIds: roleMemberIds,
          }
        });
      } else {
        const sortedExistingMembers = [...existing.memberIds].sort();
        if (!helperArraysEqual(roleMemberIds, sortedExistingMembers) || existing.name !== name) {
          await this.prisma.conversation.update({
            where: { id: existing.id },
            data: { memberIds: roleMemberIds, name },
          });
        }
      }
    }

    // 2. Ensure Shift Crew Channels for the current week
    const today = new Date();
    const sunday = new Date(today);
    sunday.setDate(today.getDate() - today.getDay());
    sunday.setHours(0, 0, 0, 0);

    const dayLabels = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // Group shifts by dayIndex in memory
    const shiftsByDay = Array.from({ length: 7 }, () => [] as string[]);
    for (const s of allShifts) {
      if (s.profileId) {
        shiftsByDay[s.dayIndex].push(s.profileId);
      }
    }

    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const d = new Date(sunday);
      d.setDate(sunday.getDate() + dayIndex);
      const dateStr = d.toISOString().split('T')[0];
      const dayLabel = dayLabels[dayIndex];

      const scheduledProfileIds = shiftsByDay[dayIndex];
      const crewMemberIds = Array.from(new Set([
        ...managerIds,
        ...scheduledProfileIds,
      ])).sort();

      if (crewMemberIds.length > 0) {
        const existing = existingShiftsMap.get(dateStr);
        const name = `#Crew - ${dayLabel} (${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`;
        if (!existing) {
          await this.prisma.conversation.create({
            data: {
              venueId,
              type: 'shift',
              shiftDate: dateStr,
              name,
              memberIds: crewMemberIds,
            }
          });
        } else {
          const sortedExistingMembers = [...existing.memberIds].sort();
          if (!helperArraysEqual(crewMemberIds, sortedExistingMembers) || existing.name !== name) {
            await this.prisma.conversation.update({
              where: { id: existing.id },
              data: { memberIds: crewMemberIds, name },
            });
          }
        }
      }
    }
  }

  @RequireSubscription('active')
  @Get('conversations')
  async listConversations(@VenueScope() scope: Scope) {
    if (!scope) return { groups: [], dms: [], roles: [], shifts: [] };

    // Automatically synchronize role & crew chats on list view (throttled).
    await this.ensureContextualConversationsThrottled(scope.venueId);

    const all = await this.prisma.conversation.findMany({
      where: { venueId: scope.venueId },
      orderBy: { lastMessageAt: 'desc' },
    });

    const staff = await this.prisma.profile.findMany({
      where: { venueId: scope.venueId },
      select: { id: true, fullName: true },
    });
    const nameById = new Map(staff.map((s) => [s.id, s.fullName]));

    const myReads = await this.prisma.conversationRead.findMany({
      where: { venueId: scope.venueId, profileId: scope.profileId },
    });
    const readAtByConvId = new Map(myReads.map((r) => [r.conversationId, r.readAt]));

    const mapConv = (c: typeof all[0]) => {
      const lastRead = readAtByConvId.get(c.id);
      const unread = c.lastMessageAt && (!lastRead || lastRead < c.lastMessageAt);
      return {
        _id: c.id,
        id: c.id,
        type: c.type,
        title: c.name ?? 'Group',
        lastMessageText: c.lastMessageText ?? null,
        lastMessageAt: c.lastMessageAt?.getTime() ?? null,
        unread: Boolean(unread),
      };
    };

    const groups = all
      .filter((c) => c.type === 'group' && canAccessConversation(c.memberIds, c.type, scope.profileId))
      .map(mapConv);

    const roles = all
      .filter((c) => c.type === 'role' && canAccessConversation(c.memberIds, c.type, scope.profileId))
      .map(mapConv);

    const shifts = all
      .filter((c) => c.type === 'shift' && canAccessConversation(c.memberIds, c.type, scope.profileId))
      .map(mapConv);

    const dms = all
      .filter((c) => c.type === 'dm' && c.memberIds.includes(scope.profileId))
      .map((c) => {
        const otherId = c.memberIds.find((id) => id !== scope.profileId);
        const lastRead = readAtByConvId.get(c.id);
        const unread = c.lastMessageAt && (!lastRead || lastRead < c.lastMessageAt);
        return {
          _id: c.id,
          id: c.id,
          type: 'dm' as const,
          title: (otherId && nameById.get(otherId)) || 'Direct message',
          lastMessageText: c.lastMessageText ?? null,
          lastMessageAt: c.lastMessageAt?.getTime() ?? null,
          unread: Boolean(unread),
        };
      })
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));

    return { groups, dms, roles, shifts };
  }

  @RequireSubscription('active')
  @Get('directory')
  async listDirectory(@VenueScope() scope: Scope) {
    if (!scope) return [];
    const staff = await this.prisma.profile.findMany({
      where: { venueId: scope.venueId, id: { not: scope.profileId } },
      orderBy: { fullName: 'asc' },
    });
    return staff.map((s) => ({
      _id: s.id,
      id: s.id,
      fullName: s.fullName,
      role: s.role,
      jobTitle: s.jobTitle,
    }));
  }

  @RequireSubscription('active')
  @Post('setup')
  async ensureChatSetup(@VenueScope() scope: Scope) {
    if (!scope) throw new ForbiddenException('No venue profile found');

    const existing = await this.prisma.conversation.findFirst({
      where: { venueId: scope.venueId, type: 'group', name: GENERAL_GROUP_NAME },
    });

    if (existing) return { conversationId: existing.id };

    const conv = await this.prisma.conversation.create({
      data: {
        venueId: scope.venueId,
        type: 'group',
        name: GENERAL_GROUP_NAME,
        memberIds: [],
      },
    });

    return { conversationId: conv.id };
  }

  @RequireSubscription('active')
  @Post('dm')
  async openDm(@VenueScope() scope: Scope, @Body() body: OpenDmDto) {
    if (!scope) throw new ForbiddenException('No venue profile found');

    if (body.targetProfileId === scope.profileId) {
      throw new BadRequestException('You cannot start a direct message with yourself');
    }
    const other = await this.prisma.profile.findFirst({
      where: { id: body.targetProfileId, venueId: scope.venueId },
    });
    if (!other) throw new BadRequestException('User is not in this venue');

    const existing = await this.prisma.conversation.findFirst({
      where: {
        venueId: scope.venueId,
        type: 'dm',
        memberIds: { hasEvery: [scope.profileId, body.targetProfileId] },
      },
    });
    if (existing) return { conversationId: existing.id };

    const conv = await this.prisma.conversation.create({
      data: {
        venueId: scope.venueId,
        type: 'dm',
        memberIds: [scope.profileId, body.targetProfileId],
      },
    });

    return { conversationId: conv.id };
  }

  @RequireSubscription('active')
  @Post('group')
  async createGroup(@VenueScope() scope: Scope, @Body() body: CreateGroupDto) {
    requireManager(scope);

    const name = body.name.trim();
    if (!name) throw new BadRequestException('Enter a group name');
    if (name.length > 100) throw new BadRequestException('Group name must be 100 characters or fewer');

    const memberIds = Array.from(new Set([scope.profileId, ...body.memberIds]));
    const conv = await this.prisma.conversation.create({
      data: {
        venueId: scope.venueId,
        type: 'group',
        name,
        memberIds,
      },
    });

    return { conversationId: conv.id };
  }

  @RequireSubscription('active')
  @Delete('conversations/:id')
  async deleteConversation(@VenueScope() scope: Scope, @Param('id') id: string) {
    requireManager(scope);

    const conv = await this.prisma.conversation.findFirst({
      where: { id, venueId: scope.venueId },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (!canDeleteConversation(conv.type, conv.name)) {
      throw new ForbiddenException('Only custom group chats can be deleted');
    }

    await this.prisma.$transaction([
      this.prisma.message.deleteMany({ where: { conversationId: id } }),
      this.prisma.conversation.delete({ where: { id: conv.id } }),
    ]);

    return { ok: true };
  }

  @RequireSubscription('active')
  @Get('conversations/:id/messages')
  async getMessages(@VenueScope() scope: Scope, @Param('id') id: string) {
    if (!scope) throw new ForbiddenException('No venue profile found');

    const conv = await this.prisma.conversation.findFirst({
      where: { id, venueId: scope.venueId },
    });
    if (!conv) throw new NotFoundException('Conversation not found');

    if (!canAccessConversation(conv.memberIds, conv.type, scope.profileId)) {
      throw new ForbiddenException('Not a participant');
    }

    const staff = await this.prisma.profile.findMany({
      where: { venueId: scope.venueId },
      select: { id: true, fullName: true },
    });
    const nameById = new Map(staff.map((s) => [s.id, s.fullName]));

    let title = conv.name ?? 'Chat';
    if (conv.type === 'dm') {
      const otherId = conv.memberIds.find((mid) => mid !== scope.profileId);
      title = (otherId && nameById.get(otherId)) || 'Direct message';
    }

    // Upsert read receipt for current user
    await this.prisma.conversationRead.upsert({
      where: {
        conversationId_profileId: {
          conversationId: id,
          profileId: scope.profileId,
        }
      },
      create: {
        conversationId: id,
        profileId: scope.profileId,
        venueId: scope.venueId,
        readAt: new Date(),
      },
      update: {
        readAt: new Date(),
      }
    });

    const reads = await this.prisma.conversationRead.findMany({
      where: { conversationId: id },
      select: { profileId: true, readAt: true },
    });

    const readReceipts = reads
      .filter((r) => r.profileId !== scope.profileId)
      .map((r) => ({
        name: nameById.get(r.profileId) || 'Teammate',
        readAt: r.readAt.getTime(),
      }));

    const recent = await this.prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const messages = recent.slice().reverse();

    return {
      title,
      readReceipts,
      messages: await Promise.all(messages.map(async (m) => {
        const imageId = m.imageUrl?.match(/^\/v1\/chat\/images\/([a-zA-Z0-9_-]+)$/)?.[1];
        return {
          _id: m.id,
          id: m.id,
          text: m.text,
          senderName: (m.senderId && nameById.get(m.senderId)) || 'Former teammate',
          createdAt: m.createdAt.getTime(),
          mine: m.senderId === scope.profileId,
          shiftId: m.shiftId,
          swapId: m.swapId,
          imageUrl: imageId
            ? await this.mediaAccess.createPath('chat-image', imageId, scope.venueId, m.imageUrl!)
            : m.imageUrl,
          reactions: m.reactions || {},
        };
      })),
    };
  }

  @RequireSubscription('active')
  @Post('conversations/:id/messages')
  async sendMessage(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: SendMessageDto) {
    if (!scope) throw new ForbiddenException('No venue profile found');

    const conv = await this.prisma.conversation.findFirst({
      where: { id, venueId: scope.venueId },
    });
    if (!conv) throw new NotFoundException('Conversation not found');

    if (!canAccessConversation(conv.memberIds, conv.type, scope.profileId)) {
      throw new ForbiddenException('Not a participant');
    }

    const text = body.text.trim();

    let imageUrl: string | null = null;
    if (body.imageUrl) {
      const match = body.imageUrl.match(/\/v1\/chat\/images\/([a-zA-Z0-9_-]+)/);
      if (!match) {
        throw new BadRequestException('Invalid image URL format');
      }
      const imageId = match[1];
      const image = await this.prisma.chatImage.findUnique({ where: { id: imageId } });
      if (!image || image.venueId !== scope.venueId) {
        throw new BadRequestException('Image not found or does not belong to this venue');
      }
      imageUrl = `/v1/chat/images/${image.id}`;
    }

    if (!text && !imageUrl) throw new BadRequestException('Message text or image is required');

    const now = new Date();
    const msg = await this.prisma.message.create({
      data: {
        conversationId: conv.id,
        venueId: conv.venueId,
        senderId: scope.profileId,
        text,
        shiftId: body.shiftId || null,
        swapId: body.swapId || null,
        imageUrl,
        createdAt: now,
      },
    });

    await this.prisma.conversation.update({
      where: { id: conv.id },
      data: {
        lastMessageAt: now,
        lastMessageText: (text || '📷 Image').slice(0, 80),
      },
    });

    return { _id: msg.id, id: msg.id };
  }

  @RequireSubscription('active')
  @Post('messages/:id/react')
  async toggleReaction(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: ReactDto) {
    if (!scope) throw new ForbiddenException('No venue profile found');
    const conv = await this.prisma.conversation.findFirst({
      where: { venueId: scope.venueId, messages: { some: { id } } },
    });
    if (!conv) throw new NotFoundException('Message not found');
    if (!canAccessConversation(conv.memberIds, conv.type, scope.profileId)) {
      throw new ForbiddenException('Not a participant');
    }

    // Read-modify-write on the reactions JSON column: retry on a lost race
    // (guarded by updatedAt) instead of silently dropping one user's toggle.
    const emoji = body.emoji;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const msg = await this.prisma.message.findFirst({ where: { id, venueId: scope.venueId } });
      if (!msg) throw new NotFoundException('Message not found');

      const reactions = { ...(msg.reactions as Record<string, string[]> | null) };
      let users = reactions[emoji] || [];
      if (users.includes(scope.profileId)) {
        users = users.filter((uid) => uid !== scope.profileId);
      } else {
        users = [...users, scope.profileId];
      }
      if (users.length === 0) {
        delete reactions[emoji];
      } else {
        reactions[emoji] = users;
      }

      const updated = await this.prisma.message.updateMany({
        where: { id, updatedAt: msg.updatedAt },
        data: { reactions },
      });
      if (updated.count > 0) {
        return { ok: true, reactions };
      }
      // Someone else updated the row between our read and write — retry.
    }
    throw new ConflictException('This message changed while updating your reaction. Try again.');
  }

  @RequireSubscription('active')
  @Patch('messages/:id')
  async editMessage(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: EditMessageDto) {
    if (!scope) throw new ForbiddenException('No venue profile found');
    const msg = await this.prisma.message.findFirst({ where: { id, venueId: scope.venueId } });
    if (!msg) throw new NotFoundException('Message not found');
    const conv = await this.prisma.conversation.findFirst({
      where: { id: msg.conversationId, venueId: scope.venueId },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (!canAccessConversation(conv.memberIds, conv.type, scope.profileId)) {
      throw new ForbiddenException('Not a participant');
    }
    if (msg.senderId !== scope.profileId) {
      throw new ForbiddenException('Only the sender can edit this message');
    }

    const text = body.text.trim();
    if (!text) throw new BadRequestException('Text is required');

    await this.prisma.message.update({
      where: { id },
      data: { text },
    });

    return { ok: true, text };
  }

  @RequireSubscription('active')
  @Post('images')
  async uploadImage(@VenueScope() scope: Scope, @Body() body: UploadImageDto) {
    if (!scope) throw new ForbiddenException('No venue profile found');

    const data = Buffer.from(body.dataBase64, 'base64');
    if (data.length === 0) throw new BadRequestException('Image is empty');
    if (data.length > MAX_IMAGE_BYTES) throw new BadRequestException('Image is too large (max 5MB)');
    const mime = assertAllowedImageBytes(data, body.mimeType);

    const s3Key = await this.s3ImageService.upload(data, mime, scope.venueId);

    const image = await this.prisma.chatImage.create({
      data: {
        venueId: scope.venueId,
        mimeType: mime,
        s3Key,
        uploadedBy: scope.profileId,
      },
      select: { id: true },
    });

    // Relative path so the stored value stays portable across environments;
    // the client resolves it against its configured API base when rendering.
    const path = `/v1/chat/images/${image.id}`;
    return { imageUrl: await this.mediaAccess.createPath('chat-image', image.id, scope.venueId, path) };
  }

  // React Native <Image> cannot attach the app's bearer token, so this endpoint
  // accepts a short-lived token issued only in authenticated venue responses.
  @Public()
  @SkipVenueScope()
  @Get('images/:id')
  async getImage(@Param('id') id: string, @Query('token') token: string | undefined, @Res() res: Response) {
    const image = await this.prisma.chatImage.findUnique({ where: { id } });
    if (!image) throw new NotFoundException('Image not found');
    await this.mediaAccess.assertToken(token, 'chat-image', id, image.venueId);
    const url = await this.s3ImageService.getPresignedUrl(image.s3Key);
    res.setHeader('Referrer-Policy', 'no-referrer');
    return res.redirect(302, url);
  }
}

function canAccessConversation(memberIds: string[], type: string, profileId: string) {
  if (type === 'dm') {
    return memberIds.includes(profileId);
  }
  // Deny empty membership lists — until ensureContextualConversations
  // repopulates members, nobody (including managers) can read/send. Prefer a
  // brief access gap over an open venue-wide conversation.
  if (memberIds.length === 0) return false;
  if (type === 'group' || type === 'role' || type === 'shift') {
    return memberIds.includes(profileId);
  }
  return false;
}

function canDeleteConversation(type: string, name: string | null) {
  return type === 'group' && name !== GENERAL_GROUP_NAME;
}
