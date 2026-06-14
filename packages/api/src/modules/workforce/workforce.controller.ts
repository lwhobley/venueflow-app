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
  Query,
  Req,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { Public } from '../../auth/public.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../auth/auth.guard';
import { getClientIp } from '../../common/http';
import { assertWithinSharedRateLimit } from '../../common/rate-limit';
import { EmailService } from '../../email/email.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SkipVenueScope } from '../../venue/skip-venue-scope.decorator';

const INVITE_CHECK_LIMIT_MAX = 10;
const INVITE_CHECK_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const JOIN_REQUEST_LIMIT_MAX = 5;
const JOIN_REQUEST_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const APPROVE_LIMIT_MAX = 60;
const APPROVE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

function normalisedPhone(raw: string): string {
  return raw.replace(/[\s\-().+]/g, '');
}

class InviteCheckDto {
  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;
}

class JoinRequestDto {
  @IsString()
  venueId!: string;
}

class ReviewDecisionDto {
  @IsString()
  @IsOptional()
  @MaxLength(500)
  note?: string;
}

@SkipVenueScope()
@Controller('v1/workforce')
export class WorkforceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  // ─── Public: invite check ──────────────────────────────────────────────────

  @Public()
  @Post('invite-check')
  async inviteCheck(@Req() req: Request, @Body() body: InviteCheckDto) {
    await assertWithinSharedRateLimit(this.prisma, `invite-check:ip:${getClientIp(req)}`, INVITE_CHECK_LIMIT_MAX, INVITE_CHECK_LIMIT_WINDOW_MS);

    const email = body.email?.trim().toLowerCase();
    const phone = body.phone ? normalisedPhone(body.phone) : undefined;

    if (!email && !phone) {
      throw new BadRequestException('Provide an email address or mobile number.');
    }

    const invite = await this.prisma.invite.findFirst({
      where: {
        ...(email
          ? { email: { equals: email, mode: 'insensitive' } }
          : { phone }),
      },
      include: { venue: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    if (!invite) {
      return { status: 'not_found' };
    }
    if (invite.usedBy) {
      return { status: 'used' };
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      return { status: 'expired' };
    }
    return {
      status: 'found',
      venueName: invite.venue.name,
      jobTitle: invite.jobTitle,
      role: invite.role,
      expiresAt: invite.expiresAt.getTime(),
    };
  }

  // ─── Public: venue search ──────────────────────────────────────────────────

  @Public()
  @Get('venues/search')
  async searchVenues(@Req() req: Request, @Query('q') q: string) {
    await assertWithinSharedRateLimit(this.prisma, `venue-search:ip:${getClientIp(req)}`, INVITE_CHECK_LIMIT_MAX, INVITE_CHECK_LIMIT_WINDOW_MS);

    const term = (q ?? '').trim();
    if (!term) {
      return { venues: [] };
    }

    // Exact code match takes priority; then name/address fuzzy match.
    const [byCode, byText] = await Promise.all([
      this.prisma.venue.findMany({
        where: { code: { equals: term, mode: 'insensitive' } },
        select: { id: true, name: true, address: true, code: true },
        take: 3,
      }),
      this.prisma.venue.findMany({
        where: {
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { address: { contains: term, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, address: true, code: true },
        take: 10,
      }),
    ]);

    // Merge: code matches first, then text matches without duplicates.
    const seen = new Set(byCode.map((v) => v.id));
    const merged = [
      ...byCode,
      ...byText.filter((v) => !seen.has(v.id)),
    ].slice(0, 10);

    return { venues: merged };
  }

  // ─── Authenticated: user's own join requests ───────────────────────────────

  @Get('join-requests')
  async listMyJoinRequests(@CurrentUser() user: AuthUser) {
    const requests = await this.prisma.workplaceJoinRequest.findMany({
      where: { userId: user.sub },
      include: { venue: { select: { id: true, name: true, address: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      requests: requests.map((r) => ({
        id: r.id,
        venueId: r.venueId,
        venueName: r.venue.name,
        venueAddress: r.venue.address,
        status: r.status,
        decidedAt: r.decidedAt?.getTime() ?? null,
        decisionNote: r.decisionNote ?? null,
        createdAt: r.createdAt.getTime(),
      })),
    };
  }

  @Post('join-request')
  async submitJoinRequest(@Req() req: Request, @CurrentUser() user: AuthUser, @Body() body: JoinRequestDto) {
    await this.requireVerifiedUser(user.sub);
    await assertWithinSharedRateLimit(this.prisma, `join-request:user:${user.sub}`, JOIN_REQUEST_LIMIT_MAX, JOIN_REQUEST_LIMIT_WINDOW_MS);
    await assertWithinSharedRateLimit(this.prisma, `join-request:ip:${getClientIp(req)}`, JOIN_REQUEST_LIMIT_MAX, JOIN_REQUEST_LIMIT_WINDOW_MS);

    const venue = await this.prisma.venue.findUnique({
      where: { id: body.venueId },
      select: { id: true, name: true },
    });
    if (!venue) throw new NotFoundException('Workplace not found.');

    let requestId: string;
    try {
      const rows = await this.prisma.$queryRaw<[{ requestId: string }]>`
        SELECT request_join_workplace(${user.sub}, ${body.venueId}) AS "requestId"
      `;
      requestId = rows[0]?.requestId;
      if (!requestId) throw new Error('join_request_id_missing');
    } catch (err: any) {
      const msg: string = err?.message ?? '';
      if (msg.includes('already_member')) {
        throw new BadRequestException('You are already a member of this workplace.');
      }
      if (msg.includes('duplicate_pending_request')) {
        throw new BadRequestException('You already have a pending request to join this workplace.');
      }
      throw err;
    }

    return {
      requestId,
      status: 'pending',
      venueName: venue.name,
    };
  }

  @Delete('join-request/:id')
  async cancelJoinRequest(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    try {
      await this.prisma.$queryRaw`SELECT cancel_join_request(${id}, ${user.sub})`;
    } catch (err: any) {
      const msg: string = err?.message ?? '';
      if (msg.includes('request_not_found')) throw new NotFoundException('Join request not found.');
      if (msg.includes('not_authorized')) throw new ForbiddenException('Not your join request.');
      if (msg.includes('request_not_pending')) throw new BadRequestException('Request is no longer pending.');
      throw err;
    }
    return { ok: true };
  }

  // ─── Manager: review join requests ────────────────────────────────────────

  @Get('manager/join-requests')
  async listManagerJoinRequests(@CurrentUser() user: AuthUser) {
    // Find all venues where this user is a manager/admin/owner.
    const managerProfiles = await this.prisma.profile.findMany({
      where: {
        userId: user.sub,
        role: { in: ['admin', 'owner', 'manager'] },
        venueId: { not: null },
        OR: [{ membershipStatus: null }, { membershipStatus: 'active' }],
      },
      select: { venueId: true },
    });
    const venueIds = managerProfiles.map((p) => p.venueId).filter(Boolean) as string[];
    if (!venueIds.length) return { requests: [] };

    const requests = await this.prisma.workplaceJoinRequest.findMany({
      where: { venueId: { in: venueIds }, status: 'pending' },
      include: {
        venue: { select: { id: true, name: true } },
        user: {
          select: {
            id: true,
            email: true,
            profile: { select: { fullName: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return {
      requests: requests.map((r) => ({
        id: r.id,
        venueId: r.venueId,
        venueName: r.venue.name,
        userId: r.userId,
        userName: r.user.profile?.fullName ?? null,
        userEmail: r.user.profile?.email ?? r.user.email ?? null,
        status: r.status,
        createdAt: r.createdAt.getTime(),
      })),
    };
  }

  @Post('manager/join-request/:id/approve')
  async approveJoinRequest(
    @Req() req: Request,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    await assertWithinSharedRateLimit(this.prisma, `approve:user:${user.sub}`, APPROVE_LIMIT_MAX, APPROVE_LIMIT_WINDOW_MS);
    await assertWithinSharedRateLimit(this.prisma, `approve:ip:${getClientIp(req)}`, APPROVE_LIMIT_MAX, APPROVE_LIMIT_WINDOW_MS);

    try {
      await this.prisma.$queryRaw`SELECT approve_join_request(${id}, ${user.sub})`;
    } catch (err: any) {
      const msg: string = err?.message ?? '';
      if (msg.includes('request_not_found')) throw new NotFoundException('Join request not found.');
      if (msg.includes('request_not_pending')) throw new BadRequestException('Request is no longer pending.');
      if (msg.includes('not_authorized')) throw new ForbiddenException('You are not authorized to approve requests for this workplace.');
      throw err;
    }
    void this.emailJoinRequestDecision(id, 'approved');
    return { ok: true };
  }

  @Post('manager/join-request/:id/reject')
  async rejectJoinRequest(
    @Req() req: Request,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: ReviewDecisionDto,
  ) {
    await assertWithinSharedRateLimit(this.prisma, `approve:user:${user.sub}`, APPROVE_LIMIT_MAX, APPROVE_LIMIT_WINDOW_MS);
    await assertWithinSharedRateLimit(this.prisma, `approve:ip:${getClientIp(req)}`, APPROVE_LIMIT_MAX, APPROVE_LIMIT_WINDOW_MS);

    const note = body.note?.trim() ?? null;
    try {
      await this.prisma.$queryRaw`SELECT reject_join_request(${id}, ${user.sub}, ${note})`;
    } catch (err: any) {
      const msg: string = err?.message ?? '';
      if (msg.includes('request_not_found')) throw new NotFoundException('Join request not found.');
      if (msg.includes('request_not_pending')) throw new BadRequestException('Request is no longer pending.');
      if (msg.includes('not_authorized')) throw new ForbiddenException('You are not authorized to reject requests for this workplace.');
      throw err;
    }
    void this.emailJoinRequestDecision(id, 'rejected', note);
    return { ok: true };
  }

  // ─── Manager: join request detail ─────────────────────────────────────────

  @Get('manager/join-request/:id')
  async getJoinRequestDetail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const request = await this.prisma.workplaceJoinRequest.findUnique({
      where: { id },
      include: {
        venue: { select: { id: true, name: true } },
        user: {
          select: {
            id: true,
            email: true,
            profile: { select: { fullName: true, email: true, role: true, jobTitle: true } },
          },
        },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!request) throw new NotFoundException('Join request not found.');

    // Verify actor is manager at this venue.
    const actorProfile = await this.prisma.profile.findFirst({
      where: {
        userId: user.sub,
        venueId: request.venueId,
        role: { in: ['admin', 'owner', 'manager'] },
        OR: [{ membershipStatus: null }, { membershipStatus: 'active' }],
      },
    });
    if (!actorProfile) throw new ForbiddenException('Not authorized.');

    return {
      id: request.id,
      venueId: request.venueId,
      venueName: request.venue.name,
      userId: request.userId,
      userName: request.user.profile?.fullName ?? null,
      userEmail: request.user.profile?.email ?? request.user.email ?? null,
      status: request.status,
      decidedAt: request.decidedAt?.getTime() ?? null,
      decisionNote: request.decisionNote ?? null,
      createdAt: request.createdAt.getTime(),
      events: request.events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        actorId: e.actorId ?? null,
        payload: e.payload,
        createdAt: e.createdAt.getTime(),
      })),
    };
  }

  private async emailJoinRequestDecision(id: string, decision: 'approved' | 'rejected', note?: string | null) {
    const request = await this.prisma.workplaceJoinRequest.findUnique({
      where: { id },
      include: {
        venue: { select: { name: true } },
        user: {
          select: {
            email: true,
            profile: { select: { email: true, fullName: true } },
          },
        },
      },
    });
    if (!request) return;
    const to = request.user.profile?.email ?? request.user.email;
    if (!to) return;
    const name = request.user.profile?.fullName ?? 'there';
    void this.email.send({
      to,
      subject: `Your request to join ${request.venue.name} was ${decision}`,
      text:
        decision === 'approved'
          ? `Hi ${name},\n\nYour request to join ${request.venue.name} was approved. You can now open Venue Wrangler and access the team.`
          : `Hi ${name},\n\nYour request to join ${request.venue.name} was rejected.${note ? `\n\nNote: ${note}` : ''}`,
    });
  }

  private async requireVerifiedUser(userId: string) {
    const account: any = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    } as any);
    if (!account?.emailVerifiedAt) {
      throw new ForbiddenException('Verify your email before joining a workplace.');
    }
  }
}
