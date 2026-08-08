import type { DailyBriefPriorityAction } from '../daily-brief-priority-actions';
import type { WranglerServicePhase } from './wrangler-service-phase';

export type WranglerSummary = {
  covers: number;
  reservations: number;
  vipArrivals: number;
  scheduledStaff: number;
  openShifts: number;
  lowStockItems: number;
  eightySixItems: number;
  pendingStaffRequests: number;
  seatedTables: number;
};

export function buildWranglerRecap(args: { phase: WranglerServicePhase; summary: WranglerSummary; priorities: DailyBriefPriorityAction[] }) {
  const unresolved = args.priorities.filter((item) => item.severity !== 'info');
  const headline = args.phase === 'closed'
    ? unresolved.length ? `Service closed with ${unresolved.length} item${unresolved.length === 1 ? '' : 's'} to carry forward.` : 'Service closed cleanly.'
    : args.phase === 'closing'
      ? `${args.summary.seatedTables} table${args.summary.seatedTables === 1 ? '' : 's'} still active as service winds down.`
      : `${args.summary.covers} covers across ${args.summary.reservations} reservations are in today's service picture.`;

  return {
    headline,
    metrics: [
      { label: 'Covers', value: args.summary.covers },
      { label: 'VIPs', value: args.summary.vipArrivals },
      { label: 'Open shifts', value: args.summary.openShifts },
      { label: 'Low stock', value: args.summary.lowStockItems },
    ],
    unresolved: unresolved.slice(0, 4).map((item) => ({ id: item.id, title: item.title, severity: item.severity, reason: item.reason })),
    tomorrow: unresolved.slice(0, 3).map((item) => item.reason),
  };
}

export function buildWranglerPatterns(args: { summary: WranglerSummary; priorities: DailyBriefPriorityAction[] }) {
  const patterns: Array<{ id: string; title: string; detail: string; confidence: 'live' | 'emerging' }> = [];
  if (args.summary.openShifts > 0) patterns.push({ id: 'coverage', title: 'Coverage pressure', detail: `${args.summary.openShifts} open shift${args.summary.openShifts === 1 ? '' : 's'} are increasing service risk.`, confidence: 'live' });
  if (args.summary.lowStockItems > 0 || args.summary.eightySixItems > 0) patterns.push({ id: 'stock', title: 'Inventory pressure', detail: `${args.summary.lowStockItems} low-stock and ${args.summary.eightySixItems} 86'd item${args.summary.eightySixItems === 1 ? '' : 's'} need follow-through.`, confidence: 'live' });
  if (args.priorities.some((item) => item.kind === 'floor')) patterns.push({ id: 'floor', title: 'Floor pressure', detail: 'Current seating and reservation timing are creating a floor conflict.', confidence: 'live' });
  return patterns.slice(0, 4);
}

export function answerWranglerQuestion(question: string, args: { phaseLabel: string; summary: WranglerSummary; priorities: DailyBriefPriorityAction[] }) {
  const q = question.trim().toLowerCase();
  const top = args.priorities[0];
  if (!q) return { answer: 'Ask about service pressure, staffing, the floor, stock, VIPs, or what to fix next.', sources: [] as string[] };
  if (q.includes('before') || q.includes('fix') || q.includes('attention') || q.includes('next')) {
    return top
      ? { answer: `${top.title}. ${top.reason} Recommended move: ${top.cta}.`, sources: [top.id] }
      : { answer: `Nothing needs immediate intervention during ${args.phaseLabel.toLowerCase()}.`, sources: [] };
  }
  if (q.includes('staff') || q.includes('understaff')) return { answer: `${args.summary.scheduledStaff} staff are scheduled and ${args.summary.openShifts} shifts remain open.`, sources: ['coverage'] };
  if (q.includes('stock') || q.includes('bar') || q.includes('86')) return { answer: `${args.summary.lowStockItems} items are at or below par and ${args.summary.eightySixItems} items are currently 86'd.`, sources: ['stock'] };
  if (q.includes('vip') || q.includes('guest')) return { answer: `${args.summary.vipArrivals} VIP arrival${args.summary.vipArrivals === 1 ? '' : 's'} are in today's reservation picture.`, sources: ['guest'] };
  if (q.includes('floor') || q.includes('table') || q.includes('turn')) return { answer: `${args.summary.seatedTables} tables are seated now.${top?.kind === 'floor' ? ` ${top.title}: ${top.reason}` : ' No floor issue is currently the top operational priority.'}`, sources: top?.kind === 'floor' ? [top.id] : [] };
  return { answer: top ? `During ${args.phaseLabel.toLowerCase()}, the top issue is ${top.title.toLowerCase()}. ${top.reason}` : `Service is currently under control during ${args.phaseLabel.toLowerCase()}.`, sources: top ? [top.id] : [] };
}
