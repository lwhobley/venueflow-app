import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../auth/auth.guard';
import { isAdminRole } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { PrismaService } from '../../prisma/prisma.service';

const GOAL_PERIODS = ['day', 'week'] as const;
const GOAL_STATUSES = ['open', 'done', 'cancelled'] as const;

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

function cleanText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function toMs(date: Date | null | undefined): number | null {
  return date ? date.getTime() : null;
}

function dateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dayBounds(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
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

@Controller('v1/operations')
@UseGuards(AuthGuard)
export class OperationsController {
  constructor(private readonly prisma: PrismaService) {}

  @RequireSubscription('active')
  @Get('manager-dashboard')
  async getManagerDashboard(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
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
      .filter((g) => g.status === 'open' || g.targetDate >= dateKey())
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
    const today = dateKey(now);
    const { start: todayStart, end: todayEnd } = dayBounds(now);
    const tomorrowEnd = new Date(todayEnd.getTime() + 24 * 60 * 60 * 1000);

    const [
      reservations,
      shifts,
      openTimeEntries,
      pendingRequests,
      barItems,
      prepItems,
      goals,
      events,
      posChecks,
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
        where: { venueId, dayIndex: todayStart.getDay() },
        orderBy: [{ startMinutes: 'asc' }, { jobTitle: 'asc' }],
        take: 100,
      }),
      this.prisma.timeEntry.findMany({
        where: { venueId, isOpen: true },
        select: { id: true },
        take: 200,
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
    ]);

    const lowStockItems = barItems.filter((item) => item.onHand <= item.parLevel).slice(0, 8);
    const covers = reservations.reduce((sum, row) => sum + row.partySize, 0);
    const posCovers = posChecks.reduce((sum, row) => sum + (row.guestCount ?? 0), 0);
    const salesCents = posChecks.reduce((sum, row) => sum + row.totalCents, 0);
    const scheduledCount = shifts.filter((shift) => shift.status === 'scheduled').length;
    const openShiftCount = shifts.filter((shift) => shift.status === 'open').length;
    const prepOpenCount = prepItems.filter((item) => item.kind === 'prep').length;
    const eightySixCount = prepItems.filter((item) => item.kind === 'eighty_six').length;

    const alerts = [
      openShiftCount > 0 ? `${openShiftCount} open shift${openShiftCount === 1 ? '' : 's'} today` : null,
      pendingRequests.length > 0 ? `${pendingRequests.length} staff request${pendingRequests.length === 1 ? '' : 's'} pending` : null,
      lowStockItems.length > 0 ? `${lowStockItems.length} low-stock bar item${lowStockItems.length === 1 ? '' : 's'}` : null,
      eightySixCount > 0 ? `${eightySixCount} item${eightySixCount === 1 ? '' : 's'} on the 86 list` : null,
    ].filter((value): value is string => Boolean(value));

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

  private async getProfile(user: AuthUser) {
    return this.prisma.profile.findFirst({ where: { userId: user.sub }, include: { venue: true } });
  }

  private async requireManagerProfile(user: AuthUser) {
    const profile = await this.getProfile(user);
    if (!profile?.venueId) throw new ForbiddenException('Profile is not initialized');
    if (!isAdminRole(profile.role)) throw new ForbiddenException('Not authorized');
    return profile;
  }
}
