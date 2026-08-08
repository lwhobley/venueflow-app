import type { DailyBriefPriorityAction } from '../daily-brief-priority-actions';

export type WranglerReservation = {
  id: string;
  guestName: string;
  partySize: number;
  reservationTime: number;
  tags: string[];
};

export type WranglerRuleInput = {
  now: number;
  reservations: WranglerReservation[];
  openShiftCount: number;
  lowStockCount: number;
  eightySixCount: number;
};

function minutesUntil(now: number, target: number) {
  return Math.round((target - now) / 60000);
}

export function buildWranglerRuleActions(input: WranglerRuleInput): DailyBriefPriorityAction[] {
  const actions: DailyBriefPriorityAction[] = [];

  for (const reservation of input.reservations) {
    const mins = minutesUntil(input.now, reservation.reservationTime);
    const isVip = reservation.tags.some((tag) => tag.toLowerCase().includes('vip'));
    const isLarge = reservation.partySize >= 8;

    if (mins >= 0 && mins <= 30 && (isVip || isLarge)) {
      actions.push({
        id: `arrival:${reservation.id}`,
        kind: 'event',
        tone: 'warn',
        severity: isVip ? 'warning' : 'watch',
        title: `${reservation.guestName} arrives in ${mins} min`,
        body: `${reservation.partySize} guests expected. Review seating, service notes, and floor readiness before arrival.`,
        reason: isVip ? 'VIP arrival inside the next 30 minutes.' : 'Large-party arrival inside the next 30 minutes.',
        cta: 'Open reservations',
        route: '/reservations',
        actions: [
          {
            id: `open-reservation:${reservation.id}`,
            type: 'NAVIGATE',
            label: 'Review arrival',
            route: '/reservations',
            payload: { reservationId: reservation.id },
          },
        ],
      });
    }
  }

  if (input.openShiftCount >= 3) {
    actions.push({
      id: 'coverage:critical',
      kind: 'coverage',
      tone: 'warn',
      severity: 'critical',
      title: `${input.openShiftCount} open shifts threaten service coverage`,
      body: 'Coverage is materially short for today. Resolve staffing before the busiest service window.',
      reason: 'Three or more open shifts remain unfilled.',
      cta: 'Open staff',
      route: '/staff',
      actions: [
        { id: 'coverage:open-staff', type: 'NAVIGATE', label: 'Resolve coverage', route: '/staff' },
      ],
    });
  }

  if (input.lowStockCount > 0 && input.eightySixCount > 0) {
    actions.push({
      id: 'inventory:service-risk',
      kind: 'stock',
      tone: 'warn',
      severity: 'warning',
      title: 'Inventory is already affecting service',
      body: `${input.lowStockCount} low-stock item${input.lowStockCount === 1 ? '' : 's'} and ${input.eightySixCount} item${input.eightySixCount === 1 ? '' : 's'} on the 86 list need attention.`,
      reason: 'Low stock and active 86 items are occurring at the same time.',
      cta: 'Open inventory',
      route: '/bar-stock',
      actions: [
        { id: 'inventory:open', type: 'NAVIGATE', label: 'Review inventory', route: '/bar-stock' },
      ],
    });
  }

  return actions;
}
