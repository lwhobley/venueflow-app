import { describe, expect, it } from 'vitest';
import {
  INVENTORY_RENDER_BATCH_SIZE,
  inventoryRowsForWindow,
  nextInventoryWindow,
} from './inventory-window';

describe('inventory render window', () => {
  it('limits the initial render without dropping catalog data', () => {
    const items = Array.from({ length: 120 }, (_, index) => index);
    expect(inventoryRowsForWindow(items, INVENTORY_RENDER_BATCH_SIZE)).toEqual(items.slice(0, 50));
    expect(items).toHaveLength(120);
  });

  it('grows in bounded batches and stops at the catalog size', () => {
    expect(nextInventoryWindow(50, 120)).toBe(100);
    expect(nextInventoryWindow(100, 120)).toBe(120);
    expect(nextInventoryWindow(120, 120)).toBe(120);
  });
});
