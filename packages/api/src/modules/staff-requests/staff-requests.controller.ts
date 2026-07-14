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
import { zonedDayOfWeek } from '../../common/venue-time';
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
        const hit = blackouts.find((b) => {
          const bStart = b.startDate.toISOString().split('T')[0];
          const bEnd = b.endDate.toISOString().split('T')[0];
          return reqStart <= bEnd && bStart <= reqEnd;
        });
        if (hit) {
          const bStartStr = hit.startDate.toISOString().split('T')[0];
          const bEndStr = hit.endDate.toISOString().split('T')[0];
          throw new BadRequestException(
            `Time off is blacked out ${bStartStr}${bEndStr !== bStartStr ? ` – ${bEndStr}` : ''} (${hit.reason}). Please choose other dates.`,
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
    const kindLabel = body.kind.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const reqStart = body.requestedRangeStart || body.requestedForDate;
    const reqEnd = body.requestedRangeEnd || body.requestedForDate || reqStart;
    const dateRangeStr = reqStart && reqEnd ? (reqStart === reqEnd ? reqStart : `${reqStart} – ${reqEnd}`) : null;

    void this.email.sendToVenueManagers(scope.venueId, {
      subject: `Staff Request — ${kindLabel}: Action Required`,
      text:
        `Hi Manager,\n\n` +
        `${profile.fullName} has submitted a new ${kindLabel.toLowerCase()} request. Please review and take action in the Venue Wrangler app.\n\n` +
        `Request Details\n` +
        `Detail\tInfo\n` +
        `Employee\t${profile.fullName}\n` +
        `Request Type\t${kindLabel}\n` +
        `Title\t${body.title}\n` +
        `Details\t${body.details}\n` +
        (dateRangeStr ? `Date/Range\t${dateRangeStr}\n` : '') + '\n' +
        `How to Respond\n` +
        `1. Open the Venue Wrangler app\n` +
        `2. Go to Requests & Approvals\n` +
        `3. Select the request\n` +
        `4. Tap Approve or Deny — the employee will be notified instantly\n\n` +
        `Pending requests can also be managed from your Operations Dashboard.\n\n` +
        `Questions? support@venuewrangler.com\n\n` +
        `— The Venue Wrangler Team`,
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

    const result = await this.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "StaffRequest" WHERE "id" = ${id} FOR UPDATE`;
    const request = await tx.staffRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Request not found');
    if (request.venueId !== scope.venueId) {
      throw new ForbiddenException('Request does not belong to this venue');
    }
    if (request.status !== 'pending') {
      throw new BadRequestException('Only pending requests can be reviewed');
    }

    const reviewer = await tx.profile.findUniqueOrThrow({ where: { id: scope.profileId } });

    // Handle approval side-effects
    if (body.status === 'approved') {
      if (request.kind === 'sick_leave') {
        const hours = calculateRequestHours(request.requestedRangeStart || request.requestedForDate, request.requestedRangeEnd || request.requestedForDate);
        // Atomic decrement clamped at zero so two concurrent approvals can't
        // both read the same balance and under-deduct (lost update).
        await tx.$executeRaw`
          UPDATE "Profile"
          SET "sickHoursAccrued" = GREATEST(0, "sickHoursAccrued" - ${hours})
          WHERE id = ${request.profileId}`;
      } else if (request.kind === 'time_off') {
        const hours = calculateRequestHours(request.requestedRangeStart || request.requestedForDate, request.requestedRangeEnd || request.requestedForDate);
        await tx.$executeRaw`
          UPDATE "Profile"
          SET "ptoHoursAccrued" = GREATEST(0, "ptoHoursAccrued" - ${hours})
          WHERE id = ${request.profileId}`;
      }
      
      if (request.kind === 'sick_leave' || request.kind === 'time_off') {
        const reqStart = request.requestedRangeStart || request.requestedForDate;
        const reqEnd = request.requestedRangeEnd || request.requestedForDate || reqStart;
        if (reqStart && reqEnd) {
          const venue = await tx.venue.findUnique({ where: { id: request.venueId }, select: { timezone: true } });
          const tz = venue?.timezone ?? null;
          const start = new Date(reqStart);
          const end = new Date(reqEnd);
          const dayIndices: number[] = [];
          for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            dayIndices.push(zonedDayOfWeek(tz, d.getTime()));
          }
          if (dayIndices.length > 0) {
            await tx.scheduleShift.updateMany({
              where: {
                venueId: request.venueId,
                profileId: request.profileId,
                dayIndex: { in: dayIndices },
              },
              data: {
                profileId: null,
                status: 'open',
              },
            });
          }
        }
      }

      if (request.kind === 'time_correction') {
        const correction = (request.availability as any) || {};
        if (correction.timeEntryId) {
          // Only correct a time entry that belongs to this venue AND the same
          // staff member who filed the request — never a foreign entry id
          // smuggled in via the client-supplied availability blob.
          const target = await tx.timeEntry.findFirst({
            where: { id: correction.timeEntryId, venueId: request.venueId, profileId: request.profileId },
          });
          if (!target) throw new BadRequestException('Time entry not found for this request');
          await tx.timeEntry.update({
            where: { id: target.id },
            data: {
              clockInAt: new Date(correction.clockInAt),
              clockOutAt: correction.clockOutAt ? new Date(correction.clockOutAt) : null,
              isOpen: correction.clockOutAt ? false : true,
            },
          });
        } else {
          // No specific entry ID — find an existing open entry for this profile
          // on the same calendar day and correct it. Only create a new entry if
          // none exists (the employee genuinely forgot to clock in).
          const correctedClockIn = new Date(correction.clockInAt);
          const dayStart = new Date(correctedClockIn);
          dayStart.setHours(0, 0, 0, 0);
          const dayEnd = new Date(dayStart.getTime() + 86400000);
          const existing = await tx.timeEntry.findFirst({
            where: {
              profileId: request.profileId,
              venueId: request.venueId,
              clockInAt: { gte: dayStart, lt: dayEnd },
            },
          });
          if (existing) {
            await tx.timeEntry.update({
              where: { id: existing.id },
              data: {
                clockInAt: correctedClockIn,
                clockOutAt: correction.clockOutAt ? new Date(correction.clockOutAt) : null,
                isOpen: !correction.clockOutAt,
              },
            });
          } else {
            await tx.timeEntry.create({
              data: {
                profileId: request.profileId,
                venueId: request.venueId,
                clockInAt: correctedClockIn,
                clockOutAt: correction.clockOutAt
                  ? new Date(correction.clockOutAt)
                  : new Date(correctedClockIn.getTime() + 8 * 60 * 60 * 1000),
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
    }

    const updated = await tx.staffRequest.update({
      where: { id: request.id },
      data: {
        status: body.status as RequestStatus,
        reviewerId: scope.profileId,
        reviewedAt: new Date(),
        responseNotes: body.responseNotes,
      },
    });
    return { request, reviewer, updated };
    });
    const { request, reviewer, updated } = result;

    await this.notifications.notifyProfile({
      venueId: scope.venueId,
      profileId: request.profileId,
      kind: 'request_reviewed',
      title: `Request ${body.status}`,
      body:
        body.responseNotes?.trim() ||
        `${reviewer.fullName} marked your ${request.kind.replace('_', ' ')} request ${body.status}.`,
    });
    const kindLabel = request.kind.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const statusText = body.status.charAt(0).toUpperCase() + body.status.slice(1);
    const noteText = body.responseNotes?.trim();

    void this.email.sendToProfile(request.profileId, {
      subject: `Your ${kindLabel} Request Has Been ${statusText}`,
      text:
        `Hi there,\n\n` +
        `Your ${kindLabel.toLowerCase()} request has been ${body.status} by your manager. Here are the details:\n\n` +
        `Request Review Details\n` +
        `Detail\tInfo\n` +
        `Request Type\t${kindLabel}\n` +
        `Title\t${request.title}\n` +
        `Status\t${statusText}\n` +
        `Reviewed By\t${reviewer.fullName}\n` +
        (noteText ? `Manager's Note\t${noteText}\n` : '') + '\n' +
        `Questions? support@venuewrangler.com\n\n` +
        `— The Venue Wrangler Team`,
    });

    return mapStaffRequest(updated);
  }
}
