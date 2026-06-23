import { BadRequestException, Body, Controller, Logger, Post, Req, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import type { Request } from 'express';
import { createHash, pbkdf2, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const pbkdf2Async = promisify(pbkdf2);
import { Public } from './public.decorator';
import { CurrentUser } from './current-user.decorator';
import { invalidateCachedSession } from './auth.guard';
import type { AuthUser } from './auth.guard';
import { getClientIp } from '../common/http';
import { assertWithinSharedRateLimit } from '../common/rate-limit';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';

const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
// Matches the JWT's 30-day expiry so a session and its token expire together.
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_CODE_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 600_000;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_DIGEST = 'sha256';
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_LIMIT_MAX = 12;
const MAX_FAILED_SIGN_INS = 8;
const VERIFY_EMAIL_RATE_LIMIT_MAX = 10;

class PasswordAuthDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsOptional()
  phone?: string;

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
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

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

class VerifyEmailDto {
  @IsString()
  code!: string;
}

class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

class ResetPasswordDto {
  @IsEmail()
  email!: string;

  @IsString()
  code!: string;

  @IsString()
  @MinLength(6)
  newPassword!: string;
}

@Controller('v1/auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
  ) {}

  @Public()
  @Post('password')
  async password(@Req() request: Request, @Body() body: PasswordAuthDto) {
    const email = body.email.trim().toLowerCase();
    if (!email || !body.password) throw new BadRequestException('Enter your email and password.');
    await assertWithinSharedRateLimit(this.prisma, `auth:ip:${getClientIp(request)}`, AUTH_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_WINDOW_MS);
    await assertWithinSharedRateLimit(this.prisma, `auth:email:${email}`, AUTH_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_WINDOW_MS);

    const user = await this.prisma.user.findUnique({ where: { email }, include: { password: true } });
    if (body.flow === 'signIn') {
      if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
        throw new UnauthorizedException('Too many failed sign-in attempts. Try again later.');
      }
      if (!user?.password || !(await verifyPassword(body.password, user.password.salt, user.password.passwordHash, user.password.iterations))) {
        if (user) {
          await this.recordFailedSignIn(user.id, user.failedSignInCount, user.lockedUntil);
        }
        throw new UnauthorizedException('Invalid email or password.');
      }
      if (user.failedSignInCount > 0 || user.lockedUntil) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { failedSignInCount: 0, lockedUntil: null },
        });
      }
      // Transparently upgrade hash strength on login when the stored iteration
      // count is below the current target.
      if (user.password.iterations < PASSWORD_ITERATIONS) {
        try {
          const upgraded = await hashPassword(body.password);
          await this.prisma.passwordCredential.update({
            where: { userId: user.id },
            data: { salt: upgraded.salt, passwordHash: upgraded.hash, iterations: PASSWORD_ITERATIONS },
          });
        } catch {}
      }
      return this.issueSession(user.id, email, body.fullName, body.inviteToken, body.phone);
    }

    // Reject signup whenever a password already exists, regardless of
    // verification state. Unverified accounts must use resend-verification or
    // password-reset to recover — allowing signup to overwrite an existing
    // password would let an attacker hijack unverified accounts.
    if (user?.password) {
      throw new BadRequestException('An account already exists for this email. Sign in instead.');
    }

    // Build the display name from fullName (legacy) or firstName + lastName.
    const resolvedFullName = body.fullName?.trim()
      || [body.firstName, body.lastName].filter(Boolean).join(' ').trim()
      || undefined;

    const phone = body.phone?.trim().replace(/[\s\-().+]/g, '') || undefined;

    const result = await hashPassword(body.password);
    let nextUserId: string;
    try {
      nextUserId = await this.prisma.$transaction(async (tx) => {
        const nextUser = await tx.user.upsert({
          where: { email },
          update: {
            ...(phone ? { phone } : {}),
            failedSignInCount: 0,
            lockedUntil: null,
          },
          create: { email, phone },
        });
        await tx.passwordCredential.upsert({
          where: { userId: nextUser.id },
          update: {
            salt: result.salt,
            passwordHash: result.hash,
            iterations: PASSWORD_ITERATIONS,
          },
          create: {
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
    const session = await this.issueSession(nextUserId, email, resolvedFullName, body.inviteToken, body.phone);
    // Swallow delivery errors: the account is already created and the session
    // token is ready to return. The user can request a new code from the
    // verify-email screen if the email didn't arrive.
    try {
      await this.sendVerificationEmail(nextUserId, email, session.profile.fullName);
    } catch (err: any) {
      this.logger.error(`Verification email failed for ${email}: ${err?.message ?? String(err)}`);
    }
    void this.email.send({
      to: email,
      subject: 'Welcome to Venue Wrangler',
      text:
        `Hi ${session.profile.fullName},\n\nYour Venue Wrangler account has been created and your 14-day free trial has started.\n\n` +
        'Check your email for the verification code before creating or joining a team.',
    });
    return session;
  }

  // Authenticated (not @Public): the global AuthGuard requires a valid bearer
  // token. Lets a signed-in user rotate their password; also lets a user who
  // signed up via OAuth set one for the first time.
  @Post('change-password')
  async changePassword(@Req() request: Request, @CurrentUser() user: AuthUser, @Body() body: ChangePasswordDto) {
    await assertWithinSharedRateLimit(this.prisma, `change-password:${user.sub}`, AUTH_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_WINDOW_MS);
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
    const account = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { email: true },
    });
    if (account?.email) {
      void this.email.send({
        to: account.email,
        subject: 'Your Venue Wrangler password was changed',
        text: 'Your Venue Wrangler password was changed. If you did not make this change, reset your password immediately and contact support.',
      });
    }
    return { ok: true };
  }

  @Post('verify-email/send')
  async resendVerification(@CurrentUser() user: AuthUser) {
    const account = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { email: true, emailVerifiedAt: true },
    });
    if (!account?.email) throw new BadRequestException('No email address is available for this account.');
    if (account.emailVerifiedAt) return { ok: true, alreadyVerified: true };
    await assertWithinSharedRateLimit(this.prisma, `verify-email:${user.sub}`, 5, AUTH_RATE_LIMIT_WINDOW_MS);
    await this.sendVerificationEmail(user.sub, account.email, user.name);
    return { ok: true };
  }

  @Post('verify-email')
  async verifyEmail(@Req() request: Request, @CurrentUser() user: AuthUser, @Body() body: VerifyEmailDto) {
    await assertWithinSharedRateLimit(this.prisma, `verify-email:ip:${getClientIp(request)}`, VERIFY_EMAIL_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_WINDOW_MS);
    await assertWithinSharedRateLimit(this.prisma, `verify-email:user:${user.sub}`, VERIFY_EMAIL_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_WINDOW_MS);
    const account = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { emailVerificationCodeHash: true, emailVerificationSentAt: true, emailVerifiedAt: true },
    });
    if (!account) throw new UnauthorizedException('Account not found.');
    if (account.emailVerifiedAt) return { ok: true, alreadyVerified: true };
    if (!account.emailVerificationCodeHash || !account.emailVerificationSentAt) {
      throw new BadRequestException('Request a new verification code and try again.');
    }
    if (account.emailVerificationSentAt.getTime() + EMAIL_CODE_TTL_MS < Date.now()) {
      throw new BadRequestException('That verification code has expired. Request a new code.');
    }
    if (account.emailVerificationCodeHash !== hashOneTimeCode(body.code)) {
      throw new BadRequestException('That verification code is not valid.');
    }
    await this.prisma.user.update({
      where: { id: user.sub },
      data: {
        emailVerifiedAt: new Date(),
        emailVerificationCodeHash: null,
        emailVerificationSentAt: null,
      },
    });
    return { ok: true };
  }

  @Public()
  @Post('forgot-password')
  async forgotPassword(@Req() request: Request, @Body() body: ForgotPasswordDto) {
    const email = body.email.trim().toLowerCase();
    await assertWithinSharedRateLimit(this.prisma, `forgot-password:ip:${getClientIp(request)}`, 8, AUTH_RATE_LIMIT_WINDOW_MS);
    await assertWithinSharedRateLimit(this.prisma, `forgot-password:email:${email}`, 5, AUTH_RATE_LIMIT_WINDOW_MS);

    const account = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, profile: { select: { fullName: true } } },
    });
    if (account?.email) {
      const code = makeOneTimeCode();
      await this.prisma.user.update({
        where: { id: account.id },
        data: {
          passwordResetCodeHash: hashOneTimeCode(code),
          passwordResetExpiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
          passwordResetSentAt: new Date(),
        },
      });
      await this.email.sendOrThrow({
        to: account.email,
        subject: 'Reset your Venue Wrangler password',
        text:
          `Hi ${account.profile?.fullName ?? 'there'},\n\n` +
          `Use this code to reset your Venue Wrangler password: ${code}\n\n` +
          'The code expires in 60 minutes. If you did not request a reset, you can ignore this email.',
      });
    }
    return { ok: true };
  }

  @Public()
  @Post('reset-password')
  async resetPassword(@Req() request: Request, @Body() body: ResetPasswordDto) {
    const email = body.email.trim().toLowerCase();
    await assertWithinSharedRateLimit(this.prisma, `reset-password:ip:${getClientIp(request)}`, 8, AUTH_RATE_LIMIT_WINDOW_MS);
    await assertWithinSharedRateLimit(this.prisma, `reset-password:email:${email}`, 8, AUTH_RATE_LIMIT_WINDOW_MS);

    const account = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        passwordResetCodeHash: true,
        passwordResetExpiresAt: true,
      },
    });
    if (
      !account?.passwordResetCodeHash ||
      !account.passwordResetExpiresAt ||
      account.passwordResetExpiresAt.getTime() < Date.now() ||
      account.passwordResetCodeHash !== hashOneTimeCode(body.code)
    ) {
      throw new BadRequestException('That password reset code is invalid or expired.');
    }
    const next = await hashPassword(body.newPassword);
    await this.prisma.$transaction([
      this.prisma.passwordCredential.upsert({
        where: { userId: account.id },
        update: {
          salt: next.salt,
          passwordHash: next.hash,
          iterations: PASSWORD_ITERATIONS,
        },
        create: {
          userId: account.id,
          salt: next.salt,
          passwordHash: next.hash,
          iterations: PASSWORD_ITERATIONS,
        },
      }),
      this.prisma.user.update({
        where: { id: account.id },
        data: {
          passwordResetCodeHash: null,
          passwordResetExpiresAt: null,
          passwordResetSentAt: null,
          failedSignInCount: 0,
          lockedUntil: null,
        },
      }),
      this.prisma.session.deleteMany({ where: { userId: account.id } }),
    ]);
    return { ok: true };
  }

  // Revoke the current session (this device). The bearer token stops working
  // immediately on the next request.
  @Post('logout')
  async logout(@CurrentUser() user: AuthUser) {
    if (user.sid) {
      await this.prisma.session.deleteMany({ where: { id: user.sid, userId: user.sub } });
      invalidateCachedSession(user.sid);
    }
    return { ok: true };
  }

  // Revoke every session for the account (all devices). The in-process session
  // cache will expire stale entries within SESSION_CACHE_TTL_MS (30s); we only
  // explicitly invalidate the caller's sid since we don't know the others here.
  @Post('logout-all')
  async logoutAll(@CurrentUser() user: AuthUser) {
    await this.prisma.session.deleteMany({ where: { userId: user.sub } });
    if (user.sid) invalidateCachedSession(user.sid);
    return { ok: true };
  }

  private async issueSession(userId: string, email: string, fullName?: string, inviteToken?: string, rawPhone?: string) {
    const trialEndsAt = new Date(Date.now() + TRIAL_DURATION_MS);
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    });
    const emailVerified = Boolean(account?.emailVerifiedAt);
    // inviteToken may be the long deep-link token OR the short human code.
    const inviteValue = inviteToken?.trim();
    const invite = inviteValue
      ? emailVerified
      ? await this.prisma.invite.findFirst({
          where: {
            OR: [{ token: inviteValue }, { code: { equals: inviteValue, mode: 'insensitive' } }],
            usedBy: null,
            expiresAt: { gt: new Date() },
          },
        })
      : null
      : null;
    if (invite?.email && invite.email.toLowerCase() !== email) {
      throw new UnauthorizedException('This invite was sent to a different email address.');
    }
    const phone = rawPhone?.trim().replace(/[\s\-().+]/g, '') || undefined;
    if (!invite?.email && invite?.phone && invite.phone !== phone) {
      throw new UnauthorizedException('This invite was sent to a different mobile number.');
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
            ...(existingByUser.trialEndsAt ? {} : { trialEndsAt }),
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
            data: { userId, email, fullName: trimmedFullName || claimedProfile.fullName, ...grant!, trialEndsAt: claimedProfile.trialEndsAt ?? trialEndsAt },
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
              trialEndsAt,
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
      profile: mapProfile(profile, emailVerified),
      venue: profile.venue ? mapVenue(profile.venue) : null,
    };
  }

  private async recordFailedSignIn(userId: string, failedSignInCount: number, lockedUntil: Date | null) {
    const isLocked = lockedUntil && lockedUntil.getTime() > Date.now();
    if (isLocked) return;
    const nextCount = (lockedUntil && lockedUntil.getTime() <= Date.now() ? 0 : failedSignInCount) + 1;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedSignInCount: nextCount >= MAX_FAILED_SIGN_INS ? 0 : nextCount,
        lockedUntil: nextCount >= MAX_FAILED_SIGN_INS ? new Date(Date.now() + AUTH_RATE_LIMIT_WINDOW_MS) : null,
      },
    });
  }

  private async sendVerificationEmail(userId: string, email: string, fullName?: string) {
    const code = makeOneTimeCode();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        emailVerificationCodeHash: hashOneTimeCode(code),
        emailVerificationSentAt: new Date(),
      },
    });
    await this.email.sendOrThrow({
      to: email,
      subject: 'Verify your Venue Wrangler email',
      text:
        `Hi ${fullName?.trim() || 'there'},\n\n` +
        `Use this code to verify your email address in Venue Wrangler: ${code}\n\n` +
        'This code expires in 24 hours.',
    });
  }
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
  phone?: string | null;
  altPhone?: string | null;
  address?: string | null;
  dateOfBirth?: Date | null;
  certifications?: string[];
}, emailVerified: boolean) {
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
    emailVerified,
    email_verified: emailVerified,
    trialEndsAt: profile.trialEndsAt?.getTime() ?? null,
    phone: profile.phone ?? null,
    altPhone: profile.altPhone ?? null,
    address: profile.address ?? null,
    dateOfBirth: profile.dateOfBirth?.toISOString() ?? null,
    certifications: profile.certifications ?? [],
  };
}

function makeOneTimeCode() {
  return String(randomInt(100000, 1000000));
}

function hashOneTimeCode(code: string) {
  return createHash('sha256').update(code.trim()).digest('hex');
}
