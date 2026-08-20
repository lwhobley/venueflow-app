import { Body, Controller, Post } from '@nestjs/common';
import { IsBase64, IsString, MaxLength, MinLength } from 'class-validator';
import type { AuthUser } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { SkipVenueScope } from '../../venue/skip-venue-scope.decorator';
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
  constructor(private readonly attestation: AttestationService) {}

  @SkipVenueScope()
  @Post('challenge')
  async challenge(@CurrentUser() user: AuthUser) {
    return this.attestation.issueChallenge(user.sub);
  }

  @SkipVenueScope()
  @Post('ios/register')
  async register(@CurrentUser() user: AuthUser, @Body() body: RegisterDeviceDto) {
    return this.attestation.registerDevice(user.sub, body);
  }
}
