import { BadRequestException, Body, Controller, Post, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { pbkdf2, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const pbkdf2Async = promisify(pbkdf2);
import { Public } from './public.decorator';
import { PrismaService } from '../prisma/prisma.service';

const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 210_000;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_DIGEST = 'sha256';

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

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  @Public()
  @Post('password')
  async password(@Body() body: PasswordAuthDto) {
    const email = body.email.trim().toLowerCase();
    if (!email || !body.password) throw new BadRequestException('Enter your email and password.');

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
    if (!body.inviteToken) {
      throw new BadRequestException('Account creation requires an invitation from a venue manager.');
    }

    const result = await hashPassword(body.password);
    const nextUser = await this.prisma.user.upsert({
      where: { email },
      update: {},
      create: { email },
    });
    await this.prisma.passwordCredential.create({
      data: {
        userId: nextUser.id,
        salt: result.salt,
        passwordHash: result.hash,
        iterations: PASSWORD_ITERATIONS,
      },
    });
    return this.issueSession(nextUser.id, email, body.fullName, body.inviteToken);
  }

  private async issueSession(userId: string, email: string, fullName?: string, inviteToken?: string) {
    const invite = inviteToken
      ? await this.prisma.invite.findFirst({
          where: { token: inviteToken, usedBy: null, expiresAt: { gt: new Date() } },
        })
      : null;
    const profile = await this.prisma.profile.upsert({
      where: { userId },
      update: {
        email,
        ...(fullName?.trim() ? { fullName: fullName.trim() } : {}),
        ...(invite
          ? {
              venueId: invite.venueId,
              role: invite.role,
              jobTitle: invite.jobTitle,
            }
          : {}),
      },
      create: {
        userId,
        email,
        fullName: fullName?.trim() || email.split('@')[0] || 'Team Member',
        role: invite?.role ?? 'staff',
        jobTitle: invite?.jobTitle ?? 'Staff',
        venueId: invite?.venueId ?? undefined,
        trialEndsAt: new Date(Date.now() + TRIAL_DURATION_MS),
      },
      include: { venue: true },
    });

    if (invite && !invite.usedBy) {
      await this.prisma.invite.update({
        where: { id: invite.id },
        data: { usedBy: profile.id },
      });
    }

    const token = await this.jwt.signAsync({
      sub: userId,
      email,
      name: profile.fullName,
    });

    return {
      token,
      profile: mapProfile(profile),
      venue: profile.venue ? mapVenue(profile.venue) : null,
    };
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
