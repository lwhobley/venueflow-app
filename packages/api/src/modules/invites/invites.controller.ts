import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { IsIn, IsString } from 'class-validator';
import { Role } from '@prisma/client';
import { Public } from '../../auth/public.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { isAdminRole } from '../../auth/roles';
import { mapProfileFull, mapVenue } from '../../common/mappers';
import { PrismaService } from '../../prisma/prisma.service';
import { SkipVenueScope } from '../../venue/skip-venue-scope.decorator';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { AuthUser } from '../../auth/auth.guard';
import type { VenueScopedRequest } from '../../venue/venue-scope.guard';

type Scope = VenueScopedRequest['venueScope'];

const INVITE_ROLES = ['manager', 'staff'] as const;
const ELEVATED_INVITE_ROLES = new Set(['manager']);
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

class CreateInviteDto {
  @IsString()
  @IsIn(INVITE_ROLES as unknown as string[])
  role!: string;

  @IsString()
  jobTitle!: string;
}

class RedeemInviteDto {
  @IsString()
  token!: string;
}

function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(32);
  let result = '';
  for (const byte of bytes) {
    result += chars.charAt(byte % chars.length);
  }
  return result;
}

@Controller('v1/invites')
export class InvitesController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async createInvite(@VenueScope() scope: Scope, @Body() body: CreateInviteDto) {
    if (!scope || !isAdminRole(scope.role)) {
      throw new ForbiddenException('Not authorized');
    }

    const viewerIsOwnerOrAdmin =
      scope.role === 'owner' || scope.role === 'admin' || scope.allAccess;
    if (!viewerIsOwnerOrAdmin && ELEVATED_INVITE_ROLES.has(body.role)) {
      throw new ForbiddenException('Only owners and admins can invite managers');
    }

    const jobTitle = body.jobTitle.trim();
    if (!jobTitle) throw new BadRequestException('Enter a job title');
    if (jobTitle.length > 100) {
      throw new BadRequestException('Job title must be 100 characters or fewer');
    }

    const token = generateToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    await this.prisma.invite.create({
      data: {
        venueId: scope.venueId,
        token,
        role: body.role as Role,
        jobTitle,
        createdById: scope.profileId,
        expiresAt,
      },
    });

    const base =
      process.env.APP_PUBLIC_URL?.replace(/\/$/, '') || 'venuewrangler://join';
    const inviteUrl = base.startsWith('http')
      ? `${base}/join?invite=${token}`
      : `${base}?invite=${token}`;

    return {
      token,
      inviteUrl,
      expiresAt: expiresAt.getTime(),
    };
  }

  @Public()
  @Get('preview')
  async getInvitePreview(@Query('token') token?: string) {
    if (!token) return null;
    const invite = await this.prisma.invite.findUnique({ where: { token } });
    if (!invite) return null;
    const venue = await this.prisma.venue.findUnique({ where: { id: invite.venueId } });
    if (!venue) return null;
    if (invite.role !== 'manager' && invite.role !== 'staff') return null;

    return {
      venueName: venue.name,
      role: invite.role,
      jobTitle: invite.jobTitle,
      expired: invite.expiresAt.getTime() < Date.now() || invite.usedById !== null,
    };
  }

  @SkipVenueScope()
  @Post('redeem')
  async redeemInvite(@CurrentUser() user: AuthUser, @Body() body: RedeemInviteDto) {
    if (!user?.sub) throw new UnauthorizedException('Unauthenticated');

    const invite = await this.prisma.invite.findUnique({ where: { token: body.token } });
    if (!invite) throw new NotFoundException('Invite not found or invalid');
    if (invite.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException(
        'This invite link has expired. Ask your manager for a new one.',
      );
    }
    if (invite.usedById) {
      throw new BadRequestException('This invite link has already been used.');
    }
    if (invite.role !== 'manager' && invite.role !== 'staff') {
      throw new BadRequestException(
        'This invite role is no longer supported. Ask your manager for a new invite.',
      );
    }

    const venue = await this.prisma.venue.findUnique({ where: { id: invite.venueId } });
    if (!venue) throw new NotFoundException('Venue not found');

    const profile = await this.prisma.profile.findFirst({ where: { userId: user.sub } });
    if (!profile) throw new BadRequestException('Profile not ready — please try again.');
    if (profile.venueId) {
      throw new BadRequestException('You are already a member of a venue.');
    }

    const [updatedProfile] = await this.prisma.$transaction([
      this.prisma.profile.update({
        where: { id: profile.id },
        data: {
          venueId: invite.venueId,
          role: invite.role,
          jobTitle: invite.jobTitle,
        },
      }),
      this.prisma.invite.update({
        where: { id: invite.id },
        data: { usedById: profile.id },
      }),
    ]);

    return {
      profile: mapProfileFull(updatedProfile),
      venue: mapVenue(venue),
    };
  }
}
