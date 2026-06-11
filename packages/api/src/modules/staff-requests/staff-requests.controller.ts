import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Prisma, RequestStatus } from '@prisma/client';
import { isAdminRole } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { mapStaffRequest } from '../../common/mappers';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';

type Scope = VenueScopedRequest['venueScope'];

const REQUEST_KINDS = ['add_shift', 'drop_shift', 'time_off', 'availability', 'shift_swap', 'open_shift', 'other'];
const REVIEW_STATUSES = ['approved', 'denied', 'cancelled'];

class AvailabilityBlockDto {
  @IsInt()
  dayIndex!: number;

  @IsInt()
  startMinutes!: number;

  @IsInt()
  endMinutes!: number;

  @IsBoolean()
  available!: boolean;
}

class CreateStaffRequestDto {
  @IsString()
  @IsIn(REQUEST_KINDS)
  kind!: string;

  @IsString()
  title!: string;

  @IsString()
  details!: string;

  @IsString()
  @IsOptional()
  requestedForDate?: string;

  @IsString()
  @IsOptional()
  requestedShiftId?: string;

  @IsString()
  @IsOptional()
  requestedRangeStart?: string;

  @IsString()
  @IsOptional()
  requestedRangeEnd?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => AvailabilityBlockDto)
  availability?: AvailabilityBlockDto[];
}

class ReviewStaffRequestDto {
  @IsString()
  @IsIn(REVIEW_STATUSES)
  status!: string;

  @IsString()
  @IsOptional()
  responseNotes?: string;
}

@Controller('v1/staff-requests')
export class StaffRequestsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @RequireSubscription()
  @Get()
  async listStaffRequests(@VenueScope() scope: Scope) {
    if (!scope) return [];
    const requests = await this.prisma.staffRequest.findMany({
      where: {
        venueId: scope.venueId,
        ...(isAdminRole(scope.role) ? {} : { profileId: scope.profileId }),
      },
      orderBy: { createdAt: 'desc' },
    });
    return requests.map(mapStaffRequest);
  }

  @RequireSubscription()
  @Post()
  async createStaffRequest(@VenueScope() scope: Scope, @Body() body: CreateStaffRequestDto) {
    if (!scope) throw new ForbiddenException('Profile does not belong to a venue');

    // Block time-off requests that overlap a manager-defined blackout window.
    if (body.kind === 'time_off') {
      const reqStart = body.requestedRangeStart || body.requestedForDate;
      const reqEnd = body.requestedRangeEnd || body.requestedForDate || reqStart;
      if (reqStart && reqEnd) {
        const blackouts = await this.prisma.blackoutDate.findMany({
          where: { venueId: scope.venueId },
        });
        const hit = blackouts.find((b) => reqStart <= b.endDate && b.startDate <= reqEnd);
        if (hit) {
          throw new BadRequestException(
            `Time off is blacked out ${hit.startDate}${hit.endDate !== hit.startDate ? ` – ${hit.endDate}` : ''} (${hit.reason}). Please choose other dates.`,
          );
        }
      }
    }

    const profile = await this.prisma.profile.findUniqueOrThrow({ where: { id: scope.profileId } });
    const request = await this.prisma.staffRequest.create({
      data: {
        venueId: scope.venueId,
        profileId: scope.profileId,
        kind: body.kind,
        status: 'pending',
        title: body.title,
        details: body.details,
        requestedForDate: body.requestedForDate,
        requestedShiftId: body.requestedShiftId,
        requestedRangeStart: body.requestedRangeStart,
        requestedRangeEnd: body.requestedRangeEnd,
        availability: body.availability
          ? (body.availability as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });

    await this.notifications.notifyManagers({
      venueId: scope.venueId,
      kind: 'request_created',
      title: 'New staff request',
      body: `${profile.fullName} submitted ${body.kind.replace('_', ' ')}: ${body.title}`,
    });

    return mapStaffRequest(request);
  }

  @RequireSubscription()
  @Patch(':id')
  async reviewStaffRequest(
    @VenueScope() scope: Scope,
    @Param('id') id: string,
    @Body() body: ReviewStaffRequestDto,
  ) {
    if (!scope || !isAdminRole(scope.role)) {
      throw new ForbiddenException('Not authorized');
    }

    const request = await this.prisma.staffRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Request not found');
    if (request.venueId !== scope.venueId) {
      throw new ForbiddenException('Request does not belong to this venue');
    }
    if (request.status !== 'pending') {
      throw new BadRequestException('Only pending requests can be reviewed');
    }

    const reviewer = await this.prisma.profile.findUniqueOrThrow({ where: { id: scope.profileId } });
    const updated = await this.prisma.staffRequest.update({
      where: { id: request.id },
      data: {
        status: body.status as RequestStatus,
        reviewerId: scope.profileId,
        reviewedAt: new Date(),
        responseNotes: body.responseNotes,
      },
    });

    await this.notifications.notifyProfile({
      venueId: scope.venueId,
      profileId: request.profileId,
      kind: 'request_reviewed',
      title: `Request ${body.status}`,
      body:
        body.responseNotes?.trim() ||
        `${reviewer.fullName} marked your ${request.kind.replace('_', ' ')} request ${body.status}.`,
    });

    return mapStaffRequest(updated);
  }
}
