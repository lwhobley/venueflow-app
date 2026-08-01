export const INVENTORY_RENDER_BATCH_SIZE = 50;

export function inventoryRowsForWindow<T>(items: readonly T[], visibleCount: number): T[] {
  return items.slice(0, Math.max(0, visibleCount));
}

export function nextInventoryWindow(current: number, total: number): number {
  return Math.min(Math.max(0, current) + INVENTORY_RENDER_BATCH_SIZE, Math.max(0, total));
}
