import { describe, expect, it } from 'vitest';
import type { DailyBriefPriorityAction } from '../daily-brief-priority-actions';
import { sortWranglerPrioritiesForPhase } from './wrangler-phase-priority';

function priority(kind: DailyBriefPriorityAction['kind'], severity: DailyBriefPriorityAction['severity'], title: string): DailyBriefPriorityAction {
  return {
    id: `${kind}-${title}`,
    kind,
    severity,
    tone: severity === 'info' ? 'good' : 'warn',
    title,
    body: title,
    reason: title,
    cta: 'Open',
    route: kind === 'floor' ? '/floor' : kind === 'coverage' ? '/staff' : kind === 'stock' ? '/bar-stock' : '/reports',
    actions: [],
  };
}

describe('sortWranglerPrioritiesForPhase', () => {
  it('prioritizes staffing and stock before service when severity ties', () => {
    const results = sortWranglerPrioritiesForPhase([
      priority('event', 'warning', 'Event prep'),
      priority('stock', 'warning', 'Low stock'),
      priority('coverage', 'warning', 'Open shifts'),
    ], 'pre_service');

    expect(results.map((item) => item.kind)).toEqual(['coverage', 'stock', 'event']);
  });

  it('prioritizes floor and guest pressure during live service when severity ties', () => {
    const results = sortWranglerPrioritiesForPhase([
      priority('stock', 'warning', 'Low stock'),
      priority('event', 'warning', 'VIP arrival'),
      priority('floor', 'warning', 'Table conflict'),
    ], 'active');

    expect(results.map((item) => item.kind)).toEqual(['floor', 'event', 'stock']);
  });

  it('never lets phase preference outrank severity', () => {
    const results = sortWranglerPrioritiesForPhase([
      priority('coverage', 'warning', 'Open shifts'),
      priority('floor', 'critical', 'VIP table conflict'),
    ], 'pre_service');

    expect(results[0].kind).toBe('floor');
    expect(results[0].severity).toBe('critical');
  });

  it('moves cleanup-oriented work ahead after service', () => {
    const results = sortWranglerPrioritiesForPhase([
      priority('event', 'watch', 'Tomorrow event'),
      priority('requests', 'watch', 'Pending requests'),
      priority('stock', 'watch', 'Inventory follow-up'),
    ], 'closed');

    expect(results.map((item) => item.kind)).toEqual(['requests', 'stock', 'event']);
  });
});
