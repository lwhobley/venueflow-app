import { Body, Controller, Post } from '@nestjs/common';
import { IsObject, IsString, MaxLength, MinLength } from 'class-validator';
import { RequireSubscription } from '../../../billing/require-subscription.decorator';
import { VenueScope } from '../../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../../venue/venue-scope.interceptor';
import { PrismaService } from '../../../prisma/prisma.service';
import { WranglerOperatorService } from './wrangler-operator.service';

type Scope = VenueScopedRequest['venueScope'];

class WranglerOperatorPlanDto {
  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  command!: string;
}

class WranglerOperatorExecuteDto {
  @IsObject()
  plan!: Record<string, unknown>;
}

@Controller('v1/operations/wrangler/operator')
export class WranglerOperatorController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operator: WranglerOperatorService,
  ) {}

  @RequireSubscription('active')
  @Post('plan')
  async plan(@VenueScope() scope: Scope, @Body() body: WranglerOperatorPlanDto) {
    if (!scope) return null;
    const venue = await this.prisma.venue.findUnique({ where: { id: scope.venueId }, select: { timezone: true } });
    if (!venue) return null;
    return this.operator.plan({
      venueId: scope.venueId,
      timezone: venue.timezone,
      command: body.command,
      actor: { profileId: scope.profileId, fullName: scope.fullName, role: scope.role, allAccess: scope.allAccess },
    });
  }

  @RequireSubscription('active')
  @Post('execute')
  async execute(@VenueScope() scope: Scope, @Body() body: WranglerOperatorExecuteDto) {
    if (!scope) return null;
    const venue = await this.prisma.venue.findUnique({ where: { id: scope.venueId }, select: { timezone: true } });
    if (!venue) return null;
    const plan = body.plan as any;
    return this.operator.execute({
      venueId: scope.venueId,
      timezone: venue.timezone,
      actor: { profileId: scope.profileId, fullName: scope.fullName, role: scope.role, allAccess: scope.allAccess },
      plan,
    });
  }
}
