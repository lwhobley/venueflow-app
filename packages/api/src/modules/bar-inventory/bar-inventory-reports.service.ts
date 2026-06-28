import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { csvCell } from '../../common/csv';

/**
 * Read-only bar-inventory analytics extracted from BarInventoryController.
 *
 * Demonstrates the controller -> service decomposition pattern (review item #5):
 * the controller stays responsible for routing + auth (it resolves venueId via
 * requireManagerProfile), and passes that venueId into these pure data methods.
 * Behaviour is unchanged — bodies are moved verbatim, only the venueId resolution
 * is lifted out.
 */
@Injectable()
export class BarInventoryReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Shrinkage / variance report (30-day waste+comp by category) ──────
  async shrinkageReport(venueId: string) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [movements, items] = await Promise.all([
      this.prisma.barInventoryMovement.findMany({
        where: { venueId, createdAt: { gte: thirtyDaysAgo } },
        select: { itemId: true, movementType: true, quantity: true, createdAt: true },
      }),
      this.prisma.barInventoryItem.findMany({
        where: { venueId },
        select: { id: true, category: true, name: true, unitCostCents: true },
      }),
    ]);
    const itemMap = new Map(items.map((i) => [i.id, i]));

    const byCategory = new Map<string, { received: number; waste: number; comp: number; wasteCents: number; compCents: number }>();
    const initCat = () => ({ received: 0, waste: 0, comp: 0, wasteCents: 0, compCents: 0 });

    for (const m of movements) {
      const item = itemMap.get(m.itemId);
      if (!item) continue;
      const cat = item.category;
      const entry = byCategory.get(cat) ?? initCat();
      const costCents = item.unitCostCents ?? 0;
      if (m.movementType === 'received') {
        entry.received += Math.abs(m.quantity);
      } else if (m.movementType === 'waste') {
        entry.waste += Math.abs(m.quantity);
        entry.wasteCents += Math.abs(m.quantity) * costCents;
      } else if (m.movementType === 'comp') {
        entry.comp += Math.abs(m.quantity);
        entry.compCents += Math.abs(m.quantity) * costCents;
      }
      byCategory.set(cat, entry);
    }

    const rows = Array.from(byCategory.entries()).map(([category, data]) => {
      const totalShrinkage = data.waste + data.comp;
      const shrinkagePct = data.received > 0 ? Math.round((totalShrinkage / data.received) * 1000) / 10 : null;
      return {
        category,
        receivedUnits: Math.round(data.received * 10) / 10,
        wasteUnits: Math.round(data.waste * 10) / 10,
        compUnits: Math.round(data.comp * 10) / 10,
        totalShrinkageUnits: Math.round(totalShrinkage * 10) / 10,
        shrinkagePct,
        wasteCents: Math.round(data.wasteCents),
        compCents: Math.round(data.compCents),
        totalShrinkageCents: Math.round(data.wasteCents + data.compCents),
      };
    }).sort((a, b) => (b.totalShrinkageCents) - (a.totalShrinkageCents));

    const totals = rows.reduce((acc, r) => ({
      receivedUnits: acc.receivedUnits + r.receivedUnits,
      totalShrinkageUnits: acc.totalShrinkageUnits + r.totalShrinkageUnits,
      totalShrinkageCents: acc.totalShrinkageCents + r.totalShrinkageCents,
    }), { receivedUnits: 0, totalShrinkageUnits: 0, totalShrinkageCents: 0 });

    return { rows, totals, windowDays: 30 };
  }

  // ── Purchase order draft (below-par items grouped by supplier) ───────
  async purchaseOrder(venueId: string) {
    const items = await this.prisma.barInventoryItem.findMany({
      where: { venueId },
      orderBy: [{ supplier: 'asc' }, { name: 'asc' }],
      take: 500,
    });
    const belowPar = items.filter((i) => i.onHand < i.parLevel);

    const bySupplier = new Map<string, typeof belowPar>();
    for (const item of belowPar) {
      const supplier = item.supplier?.trim() || 'Unspecified';
      const group = bySupplier.get(supplier) ?? [];
      group.push(item);
      bySupplier.set(supplier, group);
    }

    const groups = Array.from(bySupplier.entries()).map(([supplier, groupItems]) => {
      const lines = groupItems.map((item) => {
        const qtyToOrder = Math.ceil(item.parLevel - item.onHand);
        return {
          _id: item.id,
          name: item.name,
          sku: item.sku,
          unit: item.unit,
          onHand: item.onHand,
          parLevel: item.parLevel,
          qtyToOrder,
          unitCostCents: item.unitCostCents,
          lineTotalCents: item.unitCostCents != null ? Math.round(qtyToOrder * item.unitCostCents) : null,
        };
      });
      const groupTotalCents = lines.reduce((sum, l) => sum + (l.lineTotalCents ?? 0), 0);
      return { supplier, lines, groupTotalCents };
    });

    const grandTotalCents = groups.reduce((sum, g) => sum + g.groupTotalCents, 0);
    return { groups, grandTotalCents, itemCount: belowPar.length };
  }

  // ── Purchase order CSV ───────────────────────────────────────────────
  async purchaseOrderCsv(venueId: string) {
    const items = await this.prisma.barInventoryItem.findMany({
      where: { venueId },
      orderBy: [{ supplier: 'asc' }, { name: 'asc' }],
      take: 200,
    });
    const belowPar = items.filter((i) => i.onHand < i.parLevel);
    const headers = ['Supplier', 'Item', 'SKU', 'Unit', 'On Hand', 'Par', 'Order Qty', 'Unit Cost ($)', 'Line Total ($)'];
    const rows = [headers.map(csvCell).join(',')];
    for (const item of belowPar) {
      const qty = Math.ceil(item.parLevel - item.onHand);
      const unitCost = item.unitCostCents != null ? (item.unitCostCents / 100).toFixed(2) : '';
      const lineTotal = item.unitCostCents != null ? (qty * item.unitCostCents / 100).toFixed(2) : '';
      rows.push([
        csvCell(item.supplier ?? 'Unspecified'),
        csvCell(item.name),
        csvCell(item.sku),
        csvCell(item.unit),
        csvCell(item.onHand),
        csvCell(item.parLevel),
        csvCell(qty),
        csvCell(unitCost),
        csvCell(lineTotal),
      ].join(','));
    }
    return rows.join('\n');
  }

  // ── Stock aging report ───────────────────────────────────────────────
  async agingReport(venueId: string) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [items, recentMovements] = await Promise.all([
      this.prisma.barInventoryItem.findMany({ where: { venueId }, take: 500 }),
      this.prisma.barInventoryMovement.findMany({
        where: { venueId, createdAt: { gte: thirtyDaysAgo } },
        select: { itemId: true, movementType: true, createdAt: true },
      }),
    ]);

    const lastMovedAt = new Map<string, Date>();
    for (const m of recentMovements) {
      const prev = lastMovedAt.get(m.itemId);
      if (!prev || m.createdAt > prev) lastMovedAt.set(m.itemId, m.createdAt);
    }

    const uncounted = items.filter((i) => !i.lastCountedAt || i.lastCountedAt < sevenDaysAgo);
    const noActivity = items.filter((i) => !lastMovedAt.get(i.id));
    const staleCost = items.filter((i) => i.unitCostCents == null && i.onHand > 0);

    return {
      uncountedItems: uncounted.map((i) => ({
        _id: i.id,
        name: i.name,
        category: i.category,
        lastCountedAt: i.lastCountedAt?.getTime() ?? null,
        daysSinceCount: i.lastCountedAt ? Math.floor((Date.now() - i.lastCountedAt.getTime()) / 86400000) : null,
      })),
      noActivityItems: noActivity.map((i) => ({ _id: i.id, name: i.name, category: i.category, onHand: i.onHand })),
      staleCostItems: staleCost.map((i) => ({ _id: i.id, name: i.name, category: i.category, onHand: i.onHand })),
    };
  }
}
