import type { DailyBriefPriorityAction } from '../daily-brief-priority-actions';
import type { WranglerServicePhase } from './wrangler-service-phase';
import { WRANGLER_SEVERITY_RANK } from './wrangler.constants';

const PHASE_KIND_WEIGHT: Record<WranglerServicePhase, Partial<Record<DailyBriefPriorityAction['kind'], number>>> = {
  pre_service: {
    coverage: 0,
    stock: 1,
    requests: 2,
    event: 3,
    floor: 4,
    steady: 9,
  },
  active: {
    floor: 0,
    event: 1,
    coverage: 2,
    stock: 3,
    requests: 4,
    steady: 9,
  },
  closing: {
    floor: 0,
    stock: 1,
    requests: 2,
    coverage: 3,
    event: 4,
    steady: 9,
  },
  closed: {
    requests: 0,
    stock: 1,
    coverage: 2,
    event: 3,
    floor: 4,
    steady: 9,
  },
};

export function sortWranglerPrioritiesForPhase(
  items: DailyBriefPriorityAction[],
  phase: WranglerServicePhase,
) {
  return [...items].sort((a, b) => {
    const severityDelta = WRANGLER_SEVERITY_RANK[a.severity] - WRANGLER_SEVERITY_RANK[b.severity];
    if (severityDelta !== 0) return severityDelta;

    const weights = PHASE_KIND_WEIGHT[phase];
    const kindDelta = (weights[a.kind] ?? 5) - (weights[b.kind] ?? 5);
    if (kindDelta !== 0) return kindDelta;

    return a.title.localeCompare(b.title);
  });
}
