import { Body, Controller, Post, ForbiddenException } from '@nestjs/common';
import { IsIn, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { VenueScope } from '../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../venue/venue-scope.interceptor';

type Scope = VenueScopedRequest['venueScope'];

const PUSH_PLATFORMS = ['ios', 'android', 'web'] as const;

class RegisterPushTokenDto {
  @IsString()
  token!: string;

  @IsIn(PUSH_PLATFORMS)
  platform!: (typeof PUSH_PLATFORMS)[number];
}

@Controller('v1/push')
export class PushController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('token')
  async registerPushToken(@VenueScope() scope: Scope, @Body() body: RegisterPushTokenDto) {
    if (!scope) throw new ForbiddenException('No venue profile found');

    const { token, platform } = body;
    const data = {
      platform,
      venueId: scope.venueId,
      profileId: scope.profileId,
      enabled: true,
      lastSeenAt: new Date(),
    };

    const pushToken = await this.prisma.pushToken.upsert({
      where: { token },
      create: { token, ...data },
      update: data,
    });

    return { id: pushToken.id, ok: true };
  }
}
