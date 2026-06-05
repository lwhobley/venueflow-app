import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Patch,
  Post,
} from '@nestjs/common';
import { IsEmail, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../auth/auth.guard';
import { isAdminRole } from '../../auth/roles';
import { PrismaService } from '../../prisma/prisma.service';

// Mirrors TRIAL_DURATION_MS in convex/app.ts. Keep in sync with the Convex backend.
const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

type ProfileUserShape = {
  id: string;
  email: string;
  fullName: string;
  role: string;
  jobTitle: string;
  allAccess: boolean;
};

function mapUser(profile: {
  id: string;
  email: string;
  fullName: string;
  role: string;
  jobTitle: string;
  allAccess: boolean;
}): ProfileUserShape {
  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.fullName,
    role: profile.role,
    jobTitle: profile.jobTitle,
    allAccess: profile.allAccess,
  };
}

class BootstrapProfileDto {
  // Email is derived from the verified token; this is only a fallback for
  // first-time creation when the token carries no email claim.
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  fullName!: string;

  @IsString()
  @IsOptional()
  jobTitle?: string;
}

class UpdateVenueDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  @IsOptional()
  latitude?: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  @IsOptional()
  longitude?: number;

  @IsNumber()
  @Min(20)
  @Max(2000)
  @IsOptional()
  geofenceRadiusM?: number;
}

@Controller('v1/app')
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  async getMe(@CurrentUser() user: AuthUser) {
    const profile = await this.prisma.profile.findFirst({
      where: { userId: user.sub },
      include: { venue: true },
    });

    return {
      user: profile ? mapUser(profile) : null,
      venue: profile?.venue ?? null,
    };
  }

  @Post('bootstrap-profile')
  async bootstrapProfile(@CurrentUser() user: AuthUser, @Body() body: BootstrapProfileDto) {
    // Trust the authenticated identity for email, never the client. The body
    // email is only a fallback when the token has no email claim, and is only
    // applied on first creation — never to overwrite an established profile.
    const email = user.email ?? body.email;
    if (!email) {
      throw new BadRequestException('A verified email is required to bootstrap a profile');
    }

    const profile = await this.prisma.profile.upsert({
      where: { userId: user.sub },
      // Do not overwrite identity (email/fullName) on subsequent calls — only
      // refresh the mutable jobTitle when one is supplied.
      update: {
        jobTitle: body.jobTitle ?? undefined,
      },
      create: {
        userId: user.sub,
        email,
        fullName: body.fullName,
        role: 'staff',
        jobTitle: body.jobTitle ?? 'Staff',
        trialEndsAt: new Date(Date.now() + TRIAL_DURATION_MS),
      },
      include: { venue: true },
    });

    return {
      user: mapUser(profile),
      venue: profile.venue ?? null,
    };
  }

  @Patch('venue')
  async updateVenue(@CurrentUser() user: AuthUser, @Body() body: UpdateVenueDto) {
    const profile = await this.prisma.profile.findFirstOrThrow({ where: { userId: user.sub } });
    if (!profile.venueId) {
      return { venue: null };
    }
    if (!isAdminRole(profile.role)) {
      throw new ForbiddenException('Not authorized to update venue settings');
    }

    const venue = await this.prisma.venue.update({
      where: { id: profile.venueId },
      data: body,
    });

    return { venue };
  }

  @Delete('me')
  async deleteMyAccount(@CurrentUser() user: AuthUser) {
    const profile = await this.prisma.profile.findFirst({ where: { userId: user.sub } });
    if (!profile) {
      return { ok: true };
    }

    await this.prisma.$transaction([
      this.prisma.pushToken.deleteMany({ where: { profileId: profile.id } }),
      this.prisma.availability.deleteMany({ where: { profileId: profile.id } }),
      this.prisma.scheduleShift.updateMany({
        where: { profileId: profile.id },
        data: { profileId: null, status: 'open' },
      }),
      this.prisma.profile.delete({ where: { id: profile.id } }),
      // Delete the auth user so sessions and auth accounts cascade away,
      // preventing the deleted account from re-authenticating / resurrecting.
      ...(profile.userId
        ? [this.prisma.user.delete({ where: { id: profile.userId } })]
        : []),
    ]);

    return { ok: true };
  }
}
