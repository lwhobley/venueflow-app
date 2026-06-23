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
import { EmailService } from '../../email/email.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';

type Scope = VenueScopedRequest['venueScope'];

const REQUEST_KINDS = ['add_shift', 'drop_shift', 'time_off', 'availability', 'shift_swap', 'open_shift', 'sick_leave', 'time_correction', 'other'];
const REVIEW_STATUSES = ['approved', 'denied', 'cancelled'];

function calculateRequestHours(startStr?: string | null, endStr?: string | null): number {
  if (!startStr) return 8.0;
  const start = new Date(startStr);
  const end = endStr ? new Date(endStr) : start;
  const diffTime = Math.abs(end.getTime() - start.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  return diffDays * 8.0;
}

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
    private readonly email: EmailService,
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
    void this.email.sendToVenueManagers(scope.venueId, {
      subject: `New ${body.kind.replace('_', ' ')} request`,
      text: `${profile.fullName} submitted a ${body.kind.replace('_', ' ')} request.\n\nTitle: ${body.title}\nDetails: ${body.details}`,
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

    // Handle approval side-effects
    if (body.status === 'approved') {
      if (request.kind === 'sick_leave') {
        const hours = calculateRequestHours(request.requestedRangeStart || request.requestedForDate, request.requestedRangeEnd || request.requestedForDate);
        // Atomic decrement clamped at zero so two concurrent approvals can't
        // both read the same balance and under-deduct (lost update).
        await this.prisma.$executeRaw`
          UPDATE "Profile"
          SET "sickHoursAccrued" = GREATEST(0, "sickHoursAccrued" - ${hours})
          WHERE id = ${request.profileId}`;
      } else if (request.kind === 'time_off') {
        const hours = calculateRequestHours(request.requestedRangeStart || request.requestedForDate, request.requestedRangeEnd || request.requestedForDate);
        await this.prisma.$executeRaw`
          UPDATE "Profile"
          SET "ptoHoursAccrued" = GREATEST(0, "ptoHoursAccrued" - ${hours})
          WHERE id = ${request.profileId}`;
      } else if (request.kind === 'time_correction') {
        const correction = (request.availability as any) || {};
        if (correction.timeEntryId) {
          // Only correct a time entry that belongs to this venue AND the same
          // staff member who filed the request — never a foreign entry id
          // smuggled in via the client-supplied availability blob.
          const target = await this.prisma.timeEntry.findFirst({
            where: { id: correction.timeEntryId, venueId: request.venueId, profileId: request.profileId },
          });
          if (!target) throw new BadRequestException('Time entry not found for this request');
          await this.prisma.timeEntry.update({
            where: { id: target.id },
            data: {
              clockInAt: new Date(correction.clockInAt),
              clockOutAt: correction.clockOutAt ? new Date(correction.clockOutAt) : null,
              isOpen: correction.clockOutAt ? false : true,
            },
          });
        } else {
          await this.prisma.timeEntry.create({
            data: {
              profileId: request.profileId,
              venueId: request.venueId,
              clockInAt: new Date(correction.clockInAt),
              clockOutAt: correction.clockOutAt ? new Date(correction.clockOutAt) : new Date(correction.clockInAt + 8 * 60 * 60 * 1000),
              clockInLat: 0,
              clockInLng: 0,
              clockInAccuracyM: 0,
              clockInMocked: false,
              clockOutLat: 0,
              clockOutLng: 0,
              clockOutAccuracyM: 0,
              clockOutMocked: false,
              isOpen: false,
            },
          });
        }
      }
    }

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
    void this.email.sendToProfile(request.profileId, {
      subject: `Your request was ${body.status}`,
      text:
        body.responseNotes?.trim() ||
        `${reviewer.fullName} marked your ${request.kind.replace('_', ' ')} request ${body.status}.`,
    });

    return mapStaffRequest(updated);
  }
}
