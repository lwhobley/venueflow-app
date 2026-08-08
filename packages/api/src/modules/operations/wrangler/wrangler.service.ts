import { Injectable } from '@nestjs/common';
import { weekStartFor } from '../../../common/pay-period';
import { zonedDayBounds, zonedDayOfWeek, zonedIsoDate } from '../../../common/venue-time';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildDailyBriefPriorityActions, type DailyBriefPriorityAction } from '../daily-brief-priority-actions';
import { buildWranglerFloorActions } from './wrangler-floor-rules';
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
    const thirtyMinutesFromNow = new Date(nowMs + 30 * 60_000);

    const [
      reservations,
      shifts,
      pendingRequests,
      barItems,
      prepItems,
      events,
      tableStates,
      upcomingAssignments,
    ] = await Promise.all([
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
      this.prisma.tableState.findMany({
        where: { venueId },
        include: { table: { select: { id: true, label: true } } },
        take: 300,
      }),
      this.prisma.tableAssignment.findMany({
        where: {
          venueId,
          releasedAt: null,
          startsAt: { gte: now, lte: thirtyMinutesFromNow },
        },
        include: {
          table: { select: { id: true, label: true } },
          reservation: {
            select: {
              id: true,
              guestName: true,
              partySize: true,
              tags: true,
              status: true,
            },
          },
        },
        orderBy: { startsAt: 'asc' },
        take: 100,
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

    const floorPriorities = buildWranglerFloorActions({
      now: nowMs,
      tables: tableStates.map((tableState) => ({
        tableId: tableState.tableId,
        label: tableState.table.label,
        status: tableState.status,
        seatedAt: tableState.seatedAt?.getTime() ?? null,
      })),
      upcomingAssignments: upcomingAssignments
        .filter((assignment) => assignment.reservation && !['cancelled', 'no_show', 'completed'].includes(assignment.reservation.status))
        .map((assignment) => ({
          assignmentId: assignment.id,
          tableId: assignment.tableId,
          tableLabel: assignment.table.label,
          startsAt: assignment.startsAt.getTime(),
          reservationId: assignment.reservation?.id ?? null,
          guestName: assignment.reservation?.guestName ?? null,
          partySize: assignment.reservation?.partySize ?? null,
          tags: assignment.reservation?.tags ?? [],
        })),
    });

    const priorities = this.mergePriorities([...floorPriorities, ...rulePriorities, ...eventPriorities]);
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
        seatedTables: tableStates.filter((table) => table.status === 'seated').length,
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
        const key = item.kind === 'event' ? `event:${item.id}` : item.kind;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 6);
  }
}
