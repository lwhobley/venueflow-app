// Shared types + helpers for the Bar Stock screen and its extracted cards.
// Kept in one place so the screen and the memoized card components agree on shapes.

export type VelocityRow = {
  _id: string;
  name: string;
  category: string;
  onHand: number;
  parLevel: number;
  unit: string;
  usageLast4Weeks: number;
  perWeek: number;
  daysUntilEmpty: number | null;
};

export type MovementRow = {
  _id: string;
  movementType: string;
  quantity: number;
  previousOnHand: number;
  nextOnHand: number;
  notes: string | null;
  createdBy: string;
  createdAt: number;
};

export type ShrinkageRow = {
  category: string;
  receivedUnits: number;
  wasteUnits: number;
  compUnits: number;
  totalShrinkageUnits: number;
  shrinkagePct: number | null;
  wasteCents: number;
  compCents: number;
  totalShrinkageCents: number;
};

export type ShrinkageData = {
  rows: ShrinkageRow[];
  totals: { receivedUnits: number; totalShrinkageUnits: number; totalShrinkageCents: number };
  windowDays: number;
};

export type PurchaseOrderLine = {
  _id: string;
  name: string;
  sku: string | null;
  unit: string;
  onHand: number;
  parLevel: number;
  qtyToOrder: number;
  unitCostCents: number | null;
  lineTotalCents: number | null;
  dailyVelocity: number;
  predictedDemand: number;
  isPredictive: boolean;
};

export type PurchaseOrderGroup = {
  supplier: string;
  lines: PurchaseOrderLine[];
  groupTotalCents: number;
};

export type PurchaseOrderData = {
  groups: PurchaseOrderGroup[];
  grandTotalCents: number;
  itemCount: number;
};

export type CostHistoryEntry = {
  _id: string;
  oldCostCents: number;
  newCostCents: number;
  changedBy: string;
  createdAt: number;
};

export type AgingItem = {
  _id: string;
  name: string;
  category: string;
  lastCountedAt: number | null;
  daysSinceCount: number | null;
};

export type AgingReport = {
  uncountedItems: AgingItem[];
  noActivityItems: Array<{ _id: string; name: string; category: string; onHand: number }>;
  staleCostItems: Array<{ _id: string; name: string; category: string; onHand: number }>;
};

export function money(cents: number | null | undefined) {
  return `$${((cents ?? 0) / 100).toFixed(2)}`;
}
