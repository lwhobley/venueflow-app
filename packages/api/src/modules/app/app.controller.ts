import { Body, Controller, Delete, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../auth/auth.guard';
import { PrismaService } from '../../prisma/prisma.service';

class BootstrapProfileDto {
  @IsString()
  email!: string;

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
  @IsOptional()
  latitude?: number;

  @IsNumber()
  @IsOptional()
  longitude?: number;

  @IsNumber()
  @Min(25)
  @IsOptional()
  geofenceRadiusM?: number;
}

@Controller('v1/app')
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @UseGuards(AuthGuard)
  @Get('me')
  async getMe(@CurrentUser() user: AuthUser) {
    const profile = await this.prisma.profile.findFirst({
      where: { userId: user.sub },
      include: { venue: true },
    });

    return {
      user: profile
        ? {
            id: profile.id,
            email: profile.email,
            fullName: profile.fullName,
            role: profile.role,
            jobTitle: profile.jobTitle,
            allAccess: profile.allAccess,
          }
        : null,
      venue: profile?.venue ?? null,
    };
  }

  @UseGuards(AuthGuard)
  @Post('bootstrap-profile')
  async bootstrapProfile(@CurrentUser() user: AuthUser, @Body() body: BootstrapProfileDto) {
    const profile = await this.prisma.profile.upsert({
      where: { userId: user.sub },
      update: {
        email: body.email,
        fullName: body.fullName,
        jobTitle: body.jobTitle ?? 'Staff',
      },
      create: {
        userId: user.sub,
        email: body.email,
        fullName: body.fullName,
        role: 'staff',
        jobTitle: body.jobTitle ?? 'Staff',
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
      include: { venue: true },
    });

    return {
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.fullName,
        role: profile.role,
        jobTitle: profile.jobTitle,
        allAccess: profile.allAccess,
      },
      venue: profile.venue ?? null,
    };
  }

  @UseGuards(AuthGuard)
  @Patch('venue')
  async updateVenue(@CurrentUser() user: AuthUser, @Body() body: UpdateVenueDto) {
    const profile = await this.prisma.profile.findFirstOrThrow({ where: { userId: user.sub } });
    if (!profile.venueId) {
      return { venue: null };
    }

    const venue = await this.prisma.venue.update({
      where: { id: profile.venueId },
      data: body,
    });

    return { venue };
  }

  @UseGuards(AuthGuard)
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
    ]);

    return { ok: true };
  }
}
