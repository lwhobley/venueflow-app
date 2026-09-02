import { Body, ConflictException, Controller, ForbiddenException, Post } from '@nestjs/common';
import { IsIn, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { VenueScope } from '../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../venue/venue-scope.interceptor';

type Scope = VenueScopedRequest['venueScope'];

const PUSH_PLATFORMS = ['ios', 'android', 'web'] as const;

class RegisterPushTokenDto {
  @IsString()
  @MaxLength(500)
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

    const pushToken = await this.prisma.$transaction(async (tx) => {
      // Serialize registration by token so a token already owned by another
      // profile cannot be rebound during a concurrent request.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${token}))`;
      const existing = await tx.pushToken.findUnique({ where: { token } });
      if (existing && (existing.profileId !== scope.profileId || existing.venueId !== scope.venueId)) {
        throw new ConflictException('This device token is already registered to another profile.');
      }
      return tx.pushToken.upsert({
        where: { token },
        create: { ...data, token },
        update: data,
      });
    });

    return { id: pushToken.id, ok: true };
  }
}
