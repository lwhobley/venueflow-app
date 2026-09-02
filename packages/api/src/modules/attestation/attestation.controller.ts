import { Body, Controller, Post } from '@nestjs/common';
import { IsBase64, IsString, MaxLength, MinLength } from 'class-validator';
import type { AuthUser } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { SkipVenueScope } from '../../venue/skip-venue-scope.decorator';
import { assertWithinSharedRateLimit } from '../../common/rate-limit';
import { PrismaService } from '../../prisma/prisma.service';
import { AttestationService } from './attestation.service';

class RegisterDeviceDto {
  @IsString() @MinLength(1) @MaxLength(256) keyId!: string;
  @IsBase64() @MaxLength(20_000) attestation!: string;
  @IsString() @MinLength(1) @MaxLength(256) challenge!: string;
}

/**
 * Device attestation enrolment. Both routes are user-scoped rather than
 * venue-scoped — a device belongs to a person, who may work at several venues —
 * so venue scoping is skipped deliberately.
 */
@Controller('v1/attestation')
export class AttestationController {
  constructor(
    private readonly attestation: AttestationService,
    private readonly prisma: PrismaService,
  ) {}

  @SkipVenueScope()
  @Post('challenge')
  async challenge(@CurrentUser() user: AuthUser) {
    await assertWithinSharedRateLimit(
      this.prisma,
      `attestation-challenge:${user.sub}`,
      30,
      60_000,
      'Too many attestation challenge requests. Please try again in a moment.',
    );
    return this.attestation.issueChallenge(user.sub);
  }

  @SkipVenueScope()
  @Post('ios/register')
  async register(@CurrentUser() user: AuthUser, @Body() body: RegisterDeviceDto) {
    return this.attestation.registerDevice(user.sub, body);
  }
}
