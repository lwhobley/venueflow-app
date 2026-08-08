export type WranglerSeverity = 'info' | 'watch' | 'warning' | 'critical';
export type WranglerCategory = 'floor' | 'reservation' | 'guest' | 'staffing' | 'inventory' | 'service' | 'incident';

export type WranglerExecutableAction = {
  id: string;
  type: 'NAVIGATE' | 'ACKNOWLEDGE';
  label: string;
  route?: string;
  requiresConfirmation: boolean;
};

export type WranglerAlert = {
  id: string;
  category: WranglerCategory;
  severity: WranglerSeverity;
  title: string;
  detail: string;
  reason: string;
  detectedAt: number;
  actions: WranglerExecutableAction[];
};

export type WranglerSnapshot = {
  generatedAt: number;
  status: 'clear' | 'watch' | 'needs-attention';
  headline: string;
  alerts: WranglerAlert[];
};
