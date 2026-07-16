import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../auth/auth.guard';
import { isAdminRole } from '../../auth/roles';
import { Public } from '../../auth/public.decorator';
import { SkipVenueScope } from '../../venue/skip-venue-scope.decorator';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { ALLOWED_IMAGE_MIME, assertAllowedImageBytes } from '../../common/image-bytes';
import { isActiveMembership } from '../../common/membership';
import { todayInZone } from '../../common/pay-period';
import { zonedDayBounds, zonedDayOfWeek, zonedIsoDate } from '../../common/venue-time';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaAccessService } from '../chat/media-access.service';
import { S3ImageService } from '../chat/s3-image.service';
import { buildDailyBriefAlerts } from './daily-brief-alerts';
import { buildDailyBriefPriorityActions } from './daily-brief-priority-actions';
import { buildDailyBriefProfitabilityPulse } from './daily-brief-profitability';

const GOAL_PERIODS = ['day', 'week'] as const;
const GOAL_STATUSES = ['open', 'done', 'cancelled'] as const;
const LOGBOOK_CATEGORIES = ['handoff', 'incident', 'maintenance', 'general'] as const;
const CHECKLIST_KINDS = ['opening', 'closing'] as const;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

type ManagerGoalPeriod = (typeof GOAL_PERIODS)[number];
type ManagerGoalStatus = (typeof GOAL_STATUSES)[number];

class UpsertManagerGoalDto {
  @IsString()
  @IsOptional()
  goalId?: string;

  @IsString()
  title!: string;

  @IsString()
  @IsOptional()
  details?: string;

  @IsIn(GOAL_PERIODS)
  period!: ManagerGoalPeriod;

  @IsString()
  targetDate!: string;

  @IsIn(GOAL_STATUSES)
  status!: ManagerGoalStatus;
}

class LogbookEntryDto {
  @IsString()
  category!: string;

  @IsString()
  body!: string;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}

class ChecklistTemplateItemDto {
  @IsIn(CHECKLIST_KINDS)
  kind!: (typeof CHECKLIST_KINDS)[number];

  @IsString()
  title!: string;

  @IsOptional()
  @IsBoolean()
  requiresPhoto?: boolean;
}

class CompleteChecklistItemDto {
  @IsOptional()
  @IsString()
  photoBase64?: string;

  @IsOptional()
  @IsIn([...ALLOWED_IMAGE_MIME])
  photoMimeType?: string;
}

function cleanText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function toMs(date: Date | null | undefined): number | null {
  return date ? date.getTime() : null;
}

function mapGoal(goal: {
  id: string;
  venueId: string;
  title: string;
  details: string | null;
  period: string;
  targetDate: string;
  status: string;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    _id: goal.id,
    venueId: goal.venueId,
    title: goal.title,
    details: goal.details ?? null,
    period: goal.period,
    targetDate: goal.targetDate,
    status: goal.status,
    completedAt: toMs(goal.completedAt),
    createdAt: goal.createdAt.getTime(),
    updatedAt: goal.updatedAt.getTime(),
  };
}

function mapEvent(
  event: {
    id: string;
    venueId: string;
    title: string;
    startsAt: Date;
    endsAt: Date | null;
    expectedGuests: number | null;
    notes: string | null;
    reservationId: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  reservation: {
    notes: string | null;
    specialRequests: string | null;
    guestName: string;
    partySize: number;
  } | null,
) {
  return {
    _id: event.id,
    venueId: event.venueId,
    title: event.title,
    startsAt: event.startsAt.getTime(),
    endsAt: toMs(event.endsAt),
    expectedGuests: event.expectedGuests ?? null,
    notes: event.notes ?? null,
    reservationId: event.reservationId ?? null,
    reservationNotes: reservation?.notes ?? reservation?.specialRequests ?? null,
    reservationGuestName: reservation?.guestName ?? null,
    reservationPartySize: reservation?.partySize ?? null,
    createdAt: event.createdAt.getTime(),
    updatedAt: event.updatedAt.getTime(),
  };
}

function mapLogbookEntry(entry: {
  id: string;
  authorProfileId: string;
  authorName: string;
  category: string;
  body: string;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    _id: entry.id,
    authorProfileId: entry.authorProfileId,
    authorName: entry.authorName,
    category: entry.category,
    body: entry.body,
    pinned: entry.pinned,
    createdAt: entry.createdAt.getTime(),
    updatedAt: entry.updatedAt.getTime(),
  };
}

function mapChecklistItem(item: { id: string; kind: string; title: string; sortOrder: number; requiresPhoto: boolean }) {
  return {
    _id: item.id,
    kind: item.kind,
    title: item.title,
    sortOrder: item.sortOrder,
    requiresPhoto: item.requiresPhoto,
  };
}

@Controller('v1/operations')
@UseGuards(AuthGuard)
export class OperationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaAccess: MediaAccessService,
    private readonly s3ImageService: S3ImageService,
  ) {}

  @RequireSubscription('active')
  @Get('manager-dashboard')
  async getManagerDashboard(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const now = new Date();
    const timezone = profile.venue?.timezone;
    const today = zonedIsoDate(timezone, now.getTime());
    const todayBounds = zonedDayBounds(timezone, 0);
    const todayStart = new Date(todayBounds.start);
    const todayEnd = new Date(todayBounds.end);
    const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [reservations, goals, venueEvents] = await Promise.all([
      this.prisma.reservation.findMany({
        where: { venueId },
        take: 500,
        orderBy: { reservationTime: 'desc' },
      }),
      this.prisma.managerGoal.findMany({
        where: { venueId },
        take: 50,
        orderBy: { targetDate: 'desc' },
      }),
      this.prisma.venueEvent.findMany({
        where: {
          venueId,
          startsAt: { gte: todayStart, lte: weekEnd },
        },
        take: 50,
        orderBy: { startsAt: 'asc' },
      }),
    ]);

    const upcomingReservations = reservations.filter(
      (r) =>
        r.reservationTime >= now &&
        r.reservationTime <= weekEnd &&
        r.status !== 'cancelled',
    );

    const vipOrLargeReservations = upcomingReservations
      .filter(
        (r) =>
          r.partySize >= 8 ||
          r.tags.some((tag) => tag.toLowerCase().includes('vip')),
      )
      .sort((a, b) => a.reservationTime.getTime() - b.reservationTime.getTime())
      .slice(0, 8)
      .map((r) => ({
        _id: r.id,
        guestName: r.guestName,
        partySize: r.partySize,
        reservationTime: r.reservationTime.getTime(),
        tags: r.tags,
        notes: r.notes ?? r.specialRequests ?? null,
      }));

    const todayReservations = reservations.filter(
      (r) =>
        r.reservationTime >= todayStart && r.reservationTime < todayEnd,
    ).length;

    const filteredGoals = goals
      .filter((g) => g.status === 'open' || g.targetDate >= today)
      .slice(0, 8)
      .map(mapGoal);

    const visibleEvents = venueEvents.slice(0, 8);
    const reservationIds = visibleEvents
      .map((event) => event.reservationId)
      .filter((id): id is string => Boolean(id));
    const reservationsById = reservationIds.length
      ? new Map(
          (
            await this.prisma.reservation.findMany({
              where: { id: { in: reservationIds } },
              select: {
                id: true,
                notes: true,
                specialRequests: true,
                guestName: true,
                partySize: true,
              },
            })
          ).map((reservation) => [reservation.id, reservation]),
        )
      : new Map<string, { id: string; notes: string | null; specialRequests: string | null; guestName: string; partySize: number }>();

    const eventRows = visibleEvents.map((event) => mapEvent(event, event.reservationId ? reservationsById.get(event.reservationId) ?? null : null));

    return {
      totalReservations: reservations.length,
      todayReservations,
      vipOrLargeReservations,
      goals: filteredGoals,
      events: eventRows,
    };
  }

  @RequireSubscription('active')
  @Get('daily-brief')
  async getDailyBrief(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const now = new Date();
    const timezone = profile.venue?.timezone;
    const today = zonedIsoDate(timezone, now.getTime());
    const todayBounds = zonedDayBounds(timezone, 0);
    const tomorrowBounds = zonedDayBounds(timezone, 1);
    const todayStart = new Date(todayBounds.start);
    const todayEnd = new Date(todayBounds.end);
    const tomorrowEnd = new Date(tomorrowBounds.end);

    const [
      reservations,
      shifts,
      openTimeEntries,
      timeEntriesToday,
      pendingRequests,
      barItems,
      prepItems,
      goals,
      events,
      posChecks,
      openChecksCount,
    ] = await Promise.all([
      this.prisma.reservation.findMany({
        where: {
          venueId,
          reservationTime: { gte: todayStart, lt: todayEnd },
          status: { notIn: ['cancelled', 'no_show'] },
        },
        orderBy: { reservationTime: 'asc' },
        take: 100,
      }),
      this.prisma.scheduleShift.findMany({
        where: { venueId, dayIndex: zonedDayOfWeek(timezone, now.getTime()) },
        orderBy: [{ startMinutes: 'asc' }, { jobTitle: 'asc' }],
        take: 100,
      }),
      this.prisma.timeEntry.findMany({
        where: { venueId, isOpen: true },
        select: { id: true },
        take: 200,
      }),
      this.prisma.timeEntry.findMany({
        where: {
          venueId,
          clockInAt: { lt: tomorrowEnd },
          OR: [{ clockOutAt: null }, { clockOutAt: { gte: todayStart } }],
        },
        select: { clockInAt: true, clockOutAt: true, breaks: true, isOpen: true },
      }),
      this.prisma.staffRequest.findMany({
        where: { venueId, status: 'pending' },
        select: { id: true },
        take: 100,
      }),
      this.prisma.barInventoryItem.findMany({
        where: { venueId },
        orderBy: { name: 'asc' },
        take: 300,
      }),
      this.prisma.prepBoardItem.findMany({
        where: {
          venueId,
          status: 'open',
          OR: [{ dueDate: null }, { dueDate: { lte: today } }],
        },
        orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
        take: 50,
      }),
      this.prisma.managerGoal.findMany({
        where: { venueId, status: 'open', targetDate: today },
        orderBy: { createdAt: 'asc' },
        take: 8,
      }),
      this.prisma.venueEvent.findMany({
        where: { venueId, startsAt: { gte: todayStart, lt: tomorrowEnd } },
        orderBy: { startsAt: 'asc' },
        take: 8,
      }),
      this.prisma.posCheck.findMany({
        where: { venueId, openedAt: { gte: todayStart, lt: todayEnd }, status: { not: 'void' } },
        select: { totalCents: true, guestCount: true },
        take: 1000,
      }),
      this.prisma.posCheck.count({ where: { venueId, status: 'open' } }),
    ]);

    const lowStockItems = barItems.filter((item) => item.onHand <= item.parLevel).slice(0, 8);
    const reservationsById = new Map(reservations.map((reservation) => [reservation.id, reservation]));
    const covers = reservations.reduce((sum, row) => sum + row.partySize, 0);
    const posCovers = posChecks.reduce((sum, row) => sum + (row.guestCount ?? 0), 0);
    const salesCents = posChecks.reduce((sum, row) => sum + row.totalCents, 0);
    const scheduledCount = shifts.filter((shift) => shift.status === 'scheduled').length;
    const openShiftCount = shifts.filter((shift) => shift.status === 'open').length;
    const prepOpenCount = prepItems.filter((item) => item.kind === 'prep').length;
    const eightySixCount = prepItems.filter((item) => item.kind === 'eighty_six').length;

    const alerts = buildDailyBriefAlerts({
      openShiftCount,
      pendingRequestCount: pendingRequests.length,
      lowStockCount: lowStockItems.length,
      eightySixCount,
    });
    const priorityActions = buildDailyBriefPriorityActions({
      openShiftCount,
      pendingRequestCount: pendingRequests.length,
      lowStockCount: lowStockItems.length,
      eightySixCount,
      events: events.map((event) => {
        const reservation = event.reservationId ? reservationsById.get(event.reservationId) ?? null : null;
        return {
          title: event.title,
          startsAt: event.startsAt.getTime(),
          expectedGuests: event.expectedGuests,
          reservationGuestName: reservation?.guestName ?? null,
          reservationPartySize: reservation?.partySize ?? null,
          notes: event.notes ?? reservation?.notes ?? reservation?.specialRequests ?? null,
        };
      }),
    });
    const laborHours = Math.round(
      timeEntriesToday.reduce((sum, entry) => {
        const startMs = todayStart.getTime();
        const endMs = Math.min(entry.clockOutAt?.getTime() ?? now.getTime(), todayEnd.getTime());
        if (endMs <= startMs || entry.clockInAt.getTime() >= todayEnd.getTime()) return sum;
        const entryStart = Math.max(entry.clockInAt.getTime(), startMs);
        let durationMs = Math.max(0, endMs - entryStart);
        for (const rawBreak of (entry.breaks as any[]) ?? []) {
          if (rawBreak?.type !== 'unpaid' || rawBreak.startAt == null || rawBreak.endAt == null) continue;
          const breakStart = Math.max(Number(rawBreak.startAt), entryStart, startMs);
          const breakEnd = Math.min(Number(rawBreak.endAt), endMs);
          if (Number.isFinite(breakStart) && Number.isFinite(breakEnd) && breakEnd > breakStart) {
            durationMs -= breakEnd - breakStart;
          }
        }
        return sum + Math.max(0, durationMs) / 3600000;
      }, 0) * 10,
    ) / 10;
    const profitabilityPulse = buildDailyBriefProfitabilityPulse({
      salesCents,
      laborHours,
      openChecks: openChecksCount,
      activeClocks: openTimeEntries.length,
      openShiftCount,
      pendingRequestCount: pendingRequests.length,
      lowStockCount: lowStockItems.length,
      eightySixCount,
    });

    return {
      date: today,
      covers,
      posCovers,
      salesCents,
      scheduledCount,
      openShiftCount,
      clockedInCount: openTimeEntries.length,
      pendingRequestCount: pendingRequests.length,
      lowStockCount: lowStockItems.length,
      prepOpenCount,
      eightySixCount,
      alerts,
      reservations: reservations.slice(0, 6).map((reservation) => ({
        _id: reservation.id,
        guestName: reservation.guestName,
        partySize: reservation.partySize,
        reservationTime: reservation.reservationTime.getTime(),
        tags: reservation.tags,
        notes: reservation.notes ?? reservation.specialRequests ?? null,
      })),
      prepItems: prepItems.slice(0, 8).map((item) => ({
        _id: item.id,
        kind: item.kind,
        title: item.title,
        quantity: item.quantity,
        unit: item.unit,
        station: item.station,
        dueDate: item.dueDate,
      })),
      lowStockItems: lowStockItems.map((item) => ({
        _id: item.id,
        name: item.name,
        onHand: item.onHand,
        parLevel: item.parLevel,
        unit: item.unit,
      })),
      goals: goals.map(mapGoal),
      events: events.map((event) => ({
        _id: event.id,
        title: event.title,
        startsAt: event.startsAt.getTime(),
        expectedGuests: event.expectedGuests,
      })),
      priorityActions,
      profitabilityPulse,
    };
  }

  @RequireSubscription('active')
  @Patch('manager-goal')
  async upsertManagerGoal(@CurrentUser() user: AuthUser, @Body() body: UpsertManagerGoalDto) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const now = new Date();
    const title = body.title.trim();
    if (!title) throw new BadRequestException('Goal title is required');
    const payload = {
      venueId,
      title,
      details: cleanText(body.details) ?? null,
      period: body.period,
      targetDate: body.targetDate,
      status: body.status,
      completedAt: body.status === 'done' ? now : null,
      updatedAt: now,
    };
    if (body.goalId) {
      const existing = await this.prisma.managerGoal.findFirst({
        where: { id: body.goalId, venueId },
      });
      if (!existing) throw new NotFoundException('Goal not found');
      const updated = await this.prisma.managerGoal.update({
        where: { id: existing.id },
        data: payload,
      });
      return mapGoal(updated);
    }
    const created = await this.prisma.managerGoal.create({
      data: { ...payload, createdBy: profile.id, createdAt: now },
    });
    return mapGoal(created);
  }

  // ─── Manager logbook: shift handoff notes shared across the whole team ────

  @RequireSubscription('active')
  @Get('logbook')
  async listLogbook(@CurrentUser() user: AuthUser, @Query('limit') limitRaw?: string) {
    const profile = await this.requireVenueProfile(user);
    const limit = Math.min(200, Math.max(1, Number(limitRaw) || 50));
    const entries = await this.prisma.logbookEntry.findMany({
      where: { venueId: profile.venueId! },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });
    return { entries: entries.map(mapLogbookEntry) };
  }

  @RequireSubscription('active')
  @Post('logbook')
  async addLogbookEntry(@CurrentUser() user: AuthUser, @Body() body: LogbookEntryDto) {
    const profile = await this.requireVenueProfile(user);
    const text = body.body.trim();
    if (!text) throw new BadRequestException('Entry text is required');
    const category = LOGBOOK_CATEGORIES.includes(body.category as (typeof LOGBOOK_CATEGORIES)[number])
      ? body.category
      : 'general';
    const created = await this.prisma.logbookEntry.create({
      data: {
        venueId: profile.venueId!,
        authorProfileId: profile.id,
        authorName: profile.fullName,
        category,
        body: text,
        // Only managers/admins can pin an entry to the top of the feed.
        pinned: Boolean(body.pinned) && isAdminRole(profile.role),
      },
    });
    return mapLogbookEntry(created);
  }

  @RequireSubscription('active')
  @Delete('logbook/:id')
  async deleteLogbookEntry(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const profile = await this.requireVenueProfile(user);
    const entry = await this.prisma.logbookEntry.findFirst({ where: { id, venueId: profile.venueId! } });
    if (!entry) throw new NotFoundException('Entry not found');
    if (entry.authorProfileId !== profile.id && !isAdminRole(profile.role)) {
      throw new ForbiddenException('You can only remove your own entries');
    }
    await this.prisma.logbookEntry.delete({ where: { id: entry.id } });
    return { ok: true };
  }

  // ─── Opening/closing task checklists with photo proof ─────────────────────

  @RequireSubscription('active')
  @Get('checklist')
  async getChecklist(@CurrentUser() user: AuthUser, @Query('kind') kind: string, @Query('date') dateParam?: string) {
    const profile = await this.requireVenueProfile(user);
    if (!CHECKLIST_KINDS.includes(kind as (typeof CHECKLIST_KINDS)[number])) {
      throw new BadRequestException('kind must be "opening" or "closing"');
    }
    const venueId = profile.venueId!;
    const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayInZone(profile.venue?.timezone);
    const items = await this.prisma.checklistTemplateItem.findMany({
      where: { venueId, kind, active: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (items.length === 0) return { date, kind, items: [] };
    await this.ensureChecklistCompletions(venueId, items.map((item) => item.id), date);
    const completions = await this.prisma.checklistCompletion.findMany({
      where: { venueId, date, templateItemId: { in: items.map((item) => item.id) } },
    });
    const completionByItem = new Map(completions.map((completion) => [completion.templateItemId, completion]));
    return {
      date,
      kind,
      items: await Promise.all(items.map(async (item) => {
        const completion = completionByItem.get(item.id);
        return {
          _id: item.id,
          title: item.title,
          requiresPhoto: item.requiresPhoto,
          sortOrder: item.sortOrder,
          completionId: completion?.id ?? null,
          status: completion?.status ?? 'pending',
          completedByName: completion?.completedByName ?? null,
          completedAt: toMs(completion?.completedAt),
          hasPhoto: Boolean(completion?.photoKey),
          photoUrl: completion?.photoKey
            ? await this.mediaAccess.createPath(
                'checklist-photo',
                completion.id,
                venueId,
                `/v1/operations/checklist/photo/${completion.id}`,
              )
            : null,
        };
      })),
    };
  }

  @RequireSubscription('active')
  @Post('checklist/items')
  async addChecklistItem(@CurrentUser() user: AuthUser, @Body() body: ChecklistTemplateItemDto) {
    const profile = await this.requireManagerProfile(user);
    const title = body.title.trim();
    if (!title) throw new BadRequestException('Title is required');
    const sortOrder = await this.prisma.checklistTemplateItem.count({
      where: { venueId: profile.venueId!, kind: body.kind, active: true },
    });
    const created = await this.prisma.checklistTemplateItem.create({
      data: {
        venueId: profile.venueId!,
        kind: body.kind,
        title,
        requiresPhoto: Boolean(body.requiresPhoto),
        sortOrder,
      },
    });
    return mapChecklistItem(created);
  }

  @RequireSubscription('active')
  @Delete('checklist/items/:id')
  async removeChecklistItem(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const profile = await this.requireManagerProfile(user);
    const item = await this.prisma.checklistTemplateItem.findFirst({ where: { id, venueId: profile.venueId! } });
    if (!item) throw new NotFoundException('Checklist item not found');
    // Soft-deactivate rather than delete so past completions (with photo proof) stay intact.
    await this.prisma.checklistTemplateItem.update({ where: { id: item.id }, data: { active: false } });
    return { ok: true };
  }

  @RequireSubscription('active')
  @Post('checklist/complete/:completionId')
  async completeChecklistItem(
    @CurrentUser() user: AuthUser,
    @Param('completionId') completionId: string,
    @Body() body: CompleteChecklistItemDto,
  ) {
    const profile = await this.requireVenueProfile(user);
    const venueId = profile.venueId!;
    const completion = await this.prisma.checklistCompletion.findFirst({
      where: { id: completionId, venueId },
      include: { templateItem: true },
    });
    if (!completion) throw new NotFoundException('Checklist item not found');
    if (completion.status === 'done') {
      throw new BadRequestException('This task is already marked done for today');
    }
    if (completion.templateItem.requiresPhoto && !body.photoBase64) {
      throw new BadRequestException('This task requires a photo before it can be marked done');
    }
    let photoKey: string | undefined;
    if (body.photoBase64) {
      const data = Buffer.from(body.photoBase64, 'base64');
      if (data.length === 0) throw new BadRequestException('Photo is empty');
      if (data.length > MAX_PHOTO_BYTES) throw new BadRequestException('Photo is too large (max 5MB)');
      const mime = assertAllowedImageBytes(data, body.photoMimeType);
      photoKey = await this.s3ImageService.upload(data, mime, venueId);
    }
    const updated = await this.prisma.checklistCompletion.update({
      where: { id: completion.id },
      data: {
        status: 'done',
        completedBy: profile.id,
        completedByName: profile.fullName,
        completedAt: new Date(),
        ...(photoKey ? { photoKey } : {}),
      },
    });
    return {
      _id: updated.id,
      status: updated.status,
      completedByName: updated.completedByName,
      completedAt: toMs(updated.completedAt),
      hasPhoto: Boolean(updated.photoKey),
    };
  }

  // Short-lived token allows React Native <Image> to load without a bearer
  // header while keeping the permanent completion id from granting access.
  @Public()
  @SkipVenueScope()
  @Get('checklist/photo/:completionId')
  async getChecklistPhoto(
    @Param('completionId') completionId: string,
    @Query('token') token: string | undefined,
    @Res() res: Response,
  ) {
    const completion = await this.prisma.checklistCompletion.findUnique({ where: { id: completionId } });
    if (!completion?.photoKey) throw new NotFoundException('Photo not found');
    await this.mediaAccess.assertToken(token, 'checklist-photo', completionId, completion.venueId);
    const url = await this.s3ImageService.getPresignedUrl(completion.photoKey);
    res.setHeader('Referrer-Policy', 'no-referrer');
    return res.redirect(302, url);
  }

  private async ensureChecklistCompletions(venueId: string, templateItemIds: string[], date: string) {
    const existing = await this.prisma.checklistCompletion.findMany({
      where: { venueId, date, templateItemId: { in: templateItemIds } },
      select: { templateItemId: true },
    });
    const seen = new Set(existing.map((row) => row.templateItemId));
    const missing = templateItemIds.filter((id) => !seen.has(id));
    if (missing.length === 0) return;
    await this.prisma.checklistCompletion.createMany({
      data: missing.map((templateItemId) => ({ venueId, templateItemId, date, status: 'pending' })),
      skipDuplicates: true,
    });
  }

  private async getProfile(user: AuthUser) {
    return this.prisma.profile.findUnique({ where: { userId: user.sub }, include: { venue: true } });
  }

  private async requireManagerProfile(user: AuthUser) {
    const profile = await this.requireVenueProfile(user);
    if (!isAdminRole(profile.role)) throw new ForbiddenException('Not authorized');
    return profile;
  }

  private async requireVenueProfile(user: AuthUser) {
    const profile = await this.getProfile(user);
    if (!profile?.venueId) throw new ForbiddenException('Profile is not initialized');
    if (!isActiveMembership(profile.membershipStatus)) {
      throw new ForbiddenException('Profile is not active for this venue');
    }
    return profile;
  }
}
