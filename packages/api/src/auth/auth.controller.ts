import { BadRequestException, Body, Controller, Post, Req, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import type { Request } from 'express';
import { createHash, pbkdf2, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const pbkdf2Async = promisify(pbkdf2);
import { Public } from './public.decorator';
import { CurrentUser } from './current-user.decorator';
import type { AuthUser } from './auth.guard';
import { createRateLimiter } from '../common/rate-limit';
import { PrismaService } from '../prisma/prisma.service';

const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
// Matches the JWT's 30-day expiry so a session and its token expire together.
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 210_000;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_DIGEST = 'sha256';
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_LIMIT_MAX = 12;

const assertWithinRateLimit = createRateLimiter(AUTH_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_WINDOW_MS);

class PasswordAuthDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsIn(['signIn', 'signUp'])
  flow!: 'signIn' | 'signUp';

  @IsString()
  @IsOptional()
  fullName?: string;

  @IsString()
  @IsOptional()
  inviteToken?: string;
}

class ChangePasswordDto {
  @IsString()
  @IsOptional()
  currentPassword?: string;

  @IsString()
  @MinLength(6)
  newPassword!: string;
}

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  @Public()
  @Post('password')
  async password(@Req() request: Request, @Body() body: PasswordAuthDto) {
    const email = body.email.trim().toLowerCase();
    if (!email || !body.password) throw new BadRequestException('Enter your email and password.');
    assertWithinRateLimit(`auth:ip:${getClientIp(request)}`);
    assertWithinRateLimit(`auth:email:${email}`);

    const user = await this.prisma.user.findUnique({ where: { email }, include: { password: true } });
    if (body.flow === 'signIn') {
      if (!user?.password || !(await verifyPassword(body.password, user.password.salt, user.password.passwordHash, user.password.iterations))) {
        throw new UnauthorizedException('Invalid email or password.');
      }
      return this.issueSession(user.id, email, body.fullName, body.inviteToken);
    }

    if (user?.password) {
      throw new BadRequestException('An account already exists for this email. Sign in instead.');
    }

    const result = await hashPassword(body.password);
    let nextUserId: string;
    try {
      // One transaction so two concurrent signups for the same email can't
      // interleave between the user upsert and the credential insert.
      nextUserId = await this.prisma.$transaction(async (tx) => {
        const nextUser = await tx.user.upsert({
          where: { email },
          update: {},
          create: { email },
        });
        await tx.passwordCredential.create({
          data: {
            userId: nextUser.id,
            salt: result.salt,
            passwordHash: result.hash,
            iterations: PASSWORD_ITERATIONS,
          },
        });
        return nextUser.id;
      });
    } catch (error: any) {
      // Unique violation on userId: the concurrent signup won the race.
      if (error?.code === 'P2002') {
        throw new BadRequestException('An account already exists for this email. Sign in instead.');
      }
      throw error;
    }
    return this.issueSession(nextUserId, email, body.fullName, body.inviteToken);
  }

  // Authenticated (not @Public): the global AuthGuard requires a valid bearer
  // token. Lets a signed-in user rotate their password; also lets a user who
  // signed up via OAuth set one for the first time.
  @Post('change-password')
  async changePassword(@Req() request: Request, @CurrentUser() user: AuthUser, @Body() body: ChangePasswordDto) {
    assertWithinRateLimit(`change-password:${user.sub}`);
    const existing = await this.prisma.passwordCredential.findUnique({ where: { userId: user.sub } });
    if (existing) {
      const ok = await verifyPassword(body.currentPassword ?? '', existing.salt, existing.passwordHash, existing.iterations);
      if (!ok) throw new UnauthorizedException('Current password is incorrect.');
    }
    const next = await hashPassword(body.newPassword);
    await this.prisma.passwordCredential.upsert({
      where: { userId: user.sub },
      update: { salt: next.salt, passwordHash: next.hash, iterations: PASSWORD_ITERATIONS },
      create: { userId: user.sub, salt: next.salt, passwordHash: next.hash, iterations: PASSWORD_ITERATIONS },
    });
    // Revoke every other session so a leaked/old token can't survive a password
    // change; the caller's current session (if any) stays valid.
    await this.prisma.session.deleteMany({
      where: { userId: user.sub, ...(user.sid ? { NOT: { id: user.sid } } : {}) },
    });
    return { ok: true };
  }

  // Revoke the current session (this device). The bearer token stops working
  // immediately on the next request.
  @Post('logout')
  async logout(@CurrentUser() user: AuthUser) {
    if (user.sid) {
      await this.prisma.session.deleteMany({ where: { id: user.sid, userId: user.sub } });
    }
    return { ok: true };
  }

  // Revoke every session for the account (all devices).
  @Post('logout-all')
  async logoutAll(@CurrentUser() user: AuthUser) {
    await this.prisma.session.deleteMany({ where: { userId: user.sub } });
    return { ok: true };
  }

  private async issueSession(userId: string, email: string, fullName?: string, inviteToken?: string) {
    const invite = inviteToken
      ? await this.prisma.invite.findFirst({
          where: { token: inviteToken, usedBy: null, expiresAt: { gt: new Date() } },
        })
      : null;
    if (invite?.email && invite.email.toLowerCase() !== email) {
      throw new UnauthorizedException('This invite was sent to a different email address.');
    }
    const trimmedFullName = fullName?.trim();
    const profile = await this.prisma.$transaction(async (tx) => {
      // Consume the invite atomically so it can only be redeemed once, even
      // under concurrent signups. The guarded updateMany is the lock: the loser
      // sees count 0 and proceeds as if no invite was supplied.
      let activeInvite = invite;
      if (invite) {
        const claimed = await tx.invite.updateMany({
          where: { id: invite.id, usedBy: null },
          data: { usedBy: `pending:${userId}` },
        });
        if (claimed.count === 0) activeInvite = null;
      }

      const grant = activeInvite
        ? { venueId: activeInvite.venueId, role: activeInvite.role, jobTitle: activeInvite.jobTitle }
        : null;

      const existingByUser = await tx.profile.findUnique({
        where: { userId },
        include: { venue: true },
      });
      let result;
      if (existingByUser) {
        result = await tx.profile.update({
          where: { id: existingByUser.id },
          data: {
            email,
            ...(trimmedFullName ? { fullName: trimmedFullName } : {}),
            ...(grant ?? {}),
          },
          include: { venue: true },
        });
      } else {
        // Only adopt a manager-precreated (unclaimed) profile when a valid
        // invite authorizes access to that venue. Email match alone is NOT
        // proof of ownership — signup does not verify email — so without an
        // invite we never claim an existing profile; we create a fresh one.
        const claimedProfile = grant
          ? await tx.profile.findFirst({
              where: { userId: null, venueId: grant.venueId, email: { equals: email, mode: 'insensitive' } },
              orderBy: { createdAt: 'asc' },
              include: { venue: true },
            })
          : null;
        if (claimedProfile) {
          result = await tx.profile.update({
            where: { id: claimedProfile.id },
            data: { userId, email, fullName: trimmedFullName || claimedProfile.fullName, ...grant! },
            include: { venue: true },
          });
        } else {
          result = await tx.profile.create({
            data: {
              userId,
              email,
              fullName: trimmedFullName || email.split('@')[0] || 'Team Member',
              role: grant?.role ?? 'staff',
              jobTitle: grant?.jobTitle ?? 'Staff',
              venueId: grant?.venueId ?? undefined,
              trialEndsAt: new Date(Date.now() + TRIAL_DURATION_MS),
            },
            include: { venue: true },
          });
        }
      }

      // Re-point the consumed invite from the sentinel to the real profile.
      if (activeInvite) {
        await tx.invite.update({ where: { id: activeInvite.id }, data: { usedBy: result.id } });
      }
      return result;
    });

    // Create a revocable session and bind the JWT to it (sid). The session is
    // deleted on logout / password change / account deletion, invalidating the
    // token before its 30-day JWT expiry.
    const session = await this.prisma.session.create({
      data: { userId, expiresAt: new Date(Date.now() + SESSION_DURATION_MS) },
      select: { id: true },
    });
    const token = await this.jwt.signAsync({
      sub: userId,
      email,
      name: profile.fullName,
      sid: session.id,
    });
    await this.prisma.session.update({
      where: { id: session.id },
      data: { tokenHash: createHash('sha256').update(token).digest('hex') },
    });

    return {
      token,
      profile: mapProfile(profile),
      venue: profile.venue ? mapVenue(profile.venue) : null,
    };
  }
}

function getClientIp(request: Request) {
  const forwarded = request.headers['x-forwarded-for'];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return firstForwarded?.trim() || request.ip || 'unknown';
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await pbkdf2Async(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST);
  return { salt, hash: derivedKey.toString('hex') };
}

async function verifyPassword(password: string, salt: string, expectedHash: string, iterations: number) {
  const actual = await pbkdf2Async(password, salt, iterations, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST);
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function mapVenue(venue: { id: string; name: string; latitude: number; longitude: number; geofenceRadiusM: number }) {
  return {
    _id: venue.id,
    id: venue.id,
    name: venue.name,
    latitude: venue.latitude,
    longitude: venue.longitude,
    geofenceRadiusM: venue.geofenceRadiusM,
    geofence_radius_m: venue.geofenceRadiusM,
  };
}

function mapProfile(profile: {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  jobTitle: string;
  venueId: string | null;
  allAccess: boolean;
  trialEndsAt?: Date | null;
}) {
  return {
    _id: profile.id,
    id: profile.id,
    email: profile.email,
    fullName: profile.fullName,
    full_name: profile.fullName,
    role: profile.role,
    jobTitle: profile.jobTitle,
    job_title: profile.jobTitle,
    venueId: profile.venueId,
    venue_id: profile.venueId,
    allAccess: profile.allAccess,
    all_access: profile.allAccess,
    trialEndsAt: profile.trialEndsAt?.getTime() ?? null,
  };
}
