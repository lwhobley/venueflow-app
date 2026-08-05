export type DailyBriefPriorityAction = {
  kind: 'event' | 'coverage' | 'requests' | 'stock' | 'steady';
  tone: 'good' | 'warn' | 'neutral';
  title: string;
  body: string;
  cta: string;
  route: '/reservations' | '/staff' | '/schedule' | '/bar-stock' | '/reports';
};

type DailyBriefEvent = {
  title: string;
  startsAt: number;
  expectedGuests: number | null;
  reservationGuestName: string | null;
  reservationPartySize: number | null;
  notes: string | null;
};

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function guestSummary(event: DailyBriefEvent) {
  const guestCount = event.expectedGuests ?? event.reservationPartySize;
  return guestCount ? `${pluralize(guestCount, 'guest')} expected` : 'Guest count still needs a final check';
}

function lowStockSummary(count: number) {
  return count === 1 ? '1 low-stock item needs attention' : `${count} low-stock items need attention`;
}

function eightySixSummary(count: number) {
  return count === 1 ? '1 item is already 86\'d' : `${count} items are already 86'd`;
}

export function buildDailyBriefPriorityActions(input: {
  openShiftCount: number;
  pendingRequestCount: number;
  lowStockCount: number;
  eightySixCount: number;
  events: DailyBriefEvent[];
}): DailyBriefPriorityAction[] {
  const { openShiftCount, pendingRequestCount, lowStockCount, eightySixCount, events } = input;
  const actions: DailyBriefPriorityAction[] = [];
  const nextEvent = [...events].sort((a, b) => a.startsAt - b.startsAt)[0] ?? null;

  if (nextEvent) {
    actions.push({
      kind: 'event',
      tone: 'warn',
      title: `Prep ${nextEvent.reservationGuestName ?? nextEvent.title}`,
      body: `${guestSummary(nextEvent)}. Review the run sheet, seating plan, and service notes before doors open.`,
      cta: 'Open reservations',
      route: '/reservations',
    });
  }

  if (openShiftCount > 0) {
    actions.push({
      kind: 'coverage',
      tone: 'warn',
      title: `Cover ${pluralize(openShiftCount, 'open shift')}`,
      body: 'Get the floor staffed before service so the shift starts with the right coverage.',
      cta: 'Open staff',
      route: '/staff',
    });
  }

  if (pendingRequestCount > 0) {
    actions.push({
      kind: 'requests',
      tone: 'neutral',
      title: `Review ${pluralize(pendingRequestCount, 'pending request')}`,
      body: 'Approve or deny the queue now so the schedule stays stable for the next publish.',
      cta: 'Open schedule',
      route: '/schedule',
    });
  }

  if (lowStockCount > 0 || eightySixCount > 0) {
    actions.push({
      kind: 'stock',
      tone: lowStockCount > 0 ? 'warn' : 'neutral',
      title: lowStockCount > 0
        ? lowStockCount === 1
          ? '1 low-stock item needs attention'
          : `${lowStockCount} low-stock items need attention`
        : `${pluralize(eightySixCount, 'item')} on the 86 list`,
      body: lowStockCount > 0 && eightySixCount > 0
        ? `${lowStockSummary(lowStockCount)} and ${eightySixSummary(eightySixCount)}. Refill before they interrupt service.`
        : lowStockCount > 0
          ? 'Top up the bar list before the problem turns into a comp or a missed sale.'
          : 'Keep the 86 list current so the team does not sell what the bar cannot support.',
      cta: 'Open inventory',
      route: '/bar-stock',
    });
  }

  if (actions.length === 0) {
    actions.push({
      kind: 'steady',
      tone: 'good',
      title: 'Service looks on track',
      body: 'No urgent event prep, coverage, request, or stock issues are blocking the shift.',
      cta: 'Open reports',
      route: '/reports',
    });
  }

  return actions.slice(0, 4);
}
