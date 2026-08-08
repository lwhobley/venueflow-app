import { apiRequest, useApiMutation, useApiQuery } from './api-client';

export type WranglerSeverity = 'info' | 'watch' | 'warning' | 'critical';
export type WranglerStatus = 'clear' | 'watch' | 'attention' | 'critical';
export type WranglerServicePhase = 'pre_service' | 'active' | 'closing' | 'closed';

export type WranglerAction = {
  id: string;
  type: 'NAVIGATE' | 'ACKNOWLEDGE' | 'REASSIGN_RESERVATION';
  label: string;
  route: '/reservations' | '/staff' | '/schedule' | '/bar-stock' | '/reports' | '/floor';
  requiresConfirmation: boolean;
  payload?: Record<string, string | number | boolean | null>;
};

export type WranglerPriority = {
  id: string;
  kind: 'event' | 'coverage' | 'requests' | 'stock' | 'floor' | 'steady';
  tone: 'good' | 'warn' | 'neutral';
  severity: WranglerSeverity;
  title: string;
  body: string;
  reason: string;
  cta: string;
  route: WranglerAction['route'];
  actions: WranglerAction[];
};

export type WranglerSnapshot = {
  venue: {
    _id: string;
    name: string;
  };
  generatedAt: number;
  date: string;
  status: WranglerStatus;
  servicePhase: WranglerServicePhase;
  servicePhaseLabel: string;
  summary: {
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
  priorities: WranglerPriority[];
};

export function useWrangler(enabled = true) {
  return useApiQuery<WranglerSnapshot>(['operations', 'wrangler'], '/v1/operations/wrangler', enabled);
}

export function useExecuteWranglerAction() {
  return useApiMutation<
    { type: 'REASSIGN_RESERVATION'; reservationId: string; tableId: string },
    { ok: true; type: string; reservationId: string; tableId: string }
  >(
    (body) => apiRequest('/v1/operations/wrangler/actions', { method: 'POST', body }),
    [
      ['operations', 'wrangler'],
      ['floor', 'getActiveFloorPlan'],
      ['floor', 'getFloorStats'],
      ['reservations', 'getReservationsPage'],
    ],
  );
}
