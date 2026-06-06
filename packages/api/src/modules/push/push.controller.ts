import { Body, Controller, ForbiddenException, Post } from '@nestjs/common';
import { IsIn, IsString } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.guard';

type Scope = VenueScopedRequest['venueScope'];

const PLATFORMS = ['ios', 'android', 'web'] as const;
type Platform = (typeof PLATFORMS)[number];

class RegisterPushTokenDto {
  @IsString()
  token!: string;

  @IsString()
  @IsIn(PLATFORMS as unknown as string[])
  platform!: Platform;
}

@Controller('v1/push')
export class PushController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('tokens')
  async registerToken(@VenueScope() scope: Scope, @Body() body: RegisterPushTokenDto) {
    if (!scope) {
      throw new ForbiddenException('Profile required');
    }

    const now = new Date();
    await this.prisma.pushToken.upsert({
      where: { token: body.token },
      create: {
        venueId: scope.venueId,
        profileId: scope.profileId,
        token: body.token,
        platform: body.platform,
        enabled: true,
        lastSeenAt: now,
      },
      update: {
        venueId: scope.venueId,
        profileId: scope.profileId,
        platform: body.platform,
        enabled: true,
        lastSeenAt: now,
      },
    });

    return { ok: true };
  }
}
