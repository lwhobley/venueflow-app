import { Injectable } from '@nestjs/common';
import { weekStartFor } from '../../../common/pay-period';
import { zonedDayBounds, zonedDayOfWeek, zonedIsoDate } from '../../../common/venue-time';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildDailyBriefPriorityActions, type DailyBriefPriorityAction } from '../daily-brief-priority-actions';
import { buildWranglerRuleActions } from './wrangler-rules';
import { WRANGLER_SEVERITY_RANK } from './wrangler.constants';

@Injectable()
export class WranglerService {
  constructor(private readonly prisma: PrismaService) {}

  async getSnapshot(venueId: string, timezone?: string | null) {
    const now = new Date();
    const nowMs = now.getTime();
    const today = zonedIsoDate(timezone, nowMs);
    const bounds = zonedDayBounds(timezone, 0);
    const todayStart = new Date(bounds.start);
    const todayEnd = new Date(bounds.end);
    const weekStart = weekStartFor(today);
    const dayIndex = zonedDayOfWeek(timezone, nowMs);

    const [reservations, shifts, pendingRequests, barItems, prepItems, events] = await Promise.all([
      this.prisma.reservation.findMany({
        where: {
          venueId,
          reservationTime: { gte: todayStart, lt: todayEnd },
          status: { notIn: ['cancelled', 'no_show'] },
        },
        orderBy: { reservationTime: 'asc' },
        take: 200,
      }),
      this.prisma.scheduleShift.findMany({
        where: { venueId, weekStart, dayIndex },
        orderBy: [{ startMinutes: 'asc' }, { jobTitle: 'asc' }],
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
        take: 100,
      }),
      this.prisma.venueEvent.findMany({
        where: { venueId, startsAt: { gte: todayStart, lt: todayEnd } },
        orderBy: { startsAt: 'asc' },
        take: 20,
      }),
    ]);

    const openShiftCount = shifts.filter((shift) => shift.status === 'open').length;
    const lowStockItems = barItems.filter((item) => item.onHand <= item.parLevel);
    const eightySixCount = prepItems.filter((item) => item.kind === 'eighty_six').length;

    const eventPriorities = buildDailyBriefPriorityActions({
      openShiftCount,
      pendingRequestCount: pendingRequests.length,
      lowStockCount: lowStockItems.length,
      eightySixCount,
      events: events.map((event) => ({
        title: event.title,
        startsAt: event.startsAt.getTime(),
        expectedGuests: event.expectedGuests,
        reservationGuestName: null,
        reservationPartySize: null,
        notes: event.notes,
      })),
    });

    const rulePriorities = buildWranglerRuleActions({
      now: nowMs,
      reservations: reservations.map((reservation) => ({
        id: reservation.id,
        guestName: reservation.guestName,
        partySize: reservation.partySize,
        reservationTime: reservation.reservationTime.getTime(),
        tags: reservation.tags,
      })),
      openShiftCount,
      lowStockCount: lowStockItems.length,
      eightySixCount,
    });

    const priorities = this.mergePriorities([...rulePriorities, ...eventPriorities]);
    const covers = reservations.reduce((sum, reservation) => sum + reservation.partySize, 0);
    const vipArrivals = reservations.filter((reservation) => reservation.tags.some((tag) => tag.toLowerCase().includes('vip'))).length;

    return {
      generatedAt: nowMs,
      date: today,
      summary: {
        covers,
        reservations: reservations.length,
        vipArrivals,
        scheduledStaff: shifts.filter((shift) => shift.status === 'scheduled').length,
        openShifts: openShiftCount,
        lowStockItems: lowStockItems.length,
        eightySixItems: eightySixCount,
        pendingStaffRequests: pendingRequests.length,
      },
      status: priorities.some((item) => item.severity === 'critical')
        ? 'critical'
        : priorities.some((item) => item.severity === 'warning')
          ? 'attention'
          : priorities.some((item) => item.severity === 'watch')
            ? 'watch'
            : 'clear',
      priorities,
    };
  }

  private mergePriorities(items: DailyBriefPriorityAction[]) {
    const seen = new Set<string>();
    return items
      .sort((a, b) => WRANGLER_SEVERITY_RANK[a.severity] - WRANGLER_SEVERITY_RANK[b.severity])
      .filter((item) => {
        const key = `${item.kind}:${item.route}:${item.title}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 6);
  }
}
