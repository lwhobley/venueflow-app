import { useApiQuery } from './api-client';

export type WranglerSeverity = 'info' | 'watch' | 'warning' | 'critical';
export type WranglerStatus = 'clear' | 'watch' | 'attention' | 'critical';

export type WranglerAction = {
  id: string;
  type: 'NAVIGATE' | 'ACKNOWLEDGE';
  label: string;
  route: '/reservations' | '/staff' | '/schedule' | '/bar-stock' | '/reports';
  requiresConfirmation: boolean;
};

export type WranglerPriority = {
  id: string;
  kind: 'event' | 'coverage' | 'requests' | 'stock' | 'steady';
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
  summary: {
    covers: number;
    reservations: number;
    vipArrivals: number;
    scheduledStaff: number;
    openShifts: number;
    lowStockItems: number;
    eightySixItems: number;
    pendingStaffRequests: number;
  };
  priorities: WranglerPriority[];
};

export function useWrangler(enabled = true) {
  return useApiQuery<WranglerSnapshot>(['operations', 'wrangler'], '/v1/operations/wrangler', enabled);
}
