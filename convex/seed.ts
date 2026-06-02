import { mutation } from './_generated/server';
import { v } from 'convex/values';
import { requireVenueManager } from './authz';

export const seedDemoFloorPlan = mutation({
  args: { venueId: v.id('venues') },
  returns: v.object({ floorPlanId: v.id('floorPlans') }),
  handler: async (ctx, args) => {
    await requireVenueManager(ctx, args.venueId);
    const existing = await ctx.db.query('floorPlans').withIndex('by_venue_active', (q: any) => q.eq('venueId', args.venueId).eq('isActive', true)).unique();
    if (existing) return { floorPlanId: existing._id };

    const floorPlanId = await ctx.db.insert('floorPlans', {
      venueId: args.venueId,
      name: 'Main Floor Plan',
      width: 1440,
      height: 960,
      backgroundImageUrl: null,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const sections = [
      { section: 'main' as const, count: 16, startX: 120, startY: 160, perRow: 4 },
      { section: 'patio' as const, count: 8, startX: 760, startY: 160, perRow: 4 },
      { section: 'bar' as const, count: 6, startX: 140, startY: 640, perRow: 3 },
      { section: 'vip' as const, count: 5, startX: 820, startY: 620, perRow: 2 },
    ];

    let counter = 1;
    for (const block of sections) {
      for (let index = 0; index < block.count; index += 1) {
        const row = Math.floor(index / block.perRow);
        const col = index % block.perRow;
        const shape = index % 5 === 0 ? 'rect' : index % 4 === 0 ? 'booth' : index % 3 === 0 ? 'square' : 'round';
        const width = shape === 'round' ? 72 : shape === 'square' ? 74 : shape === 'booth' ? 90 : 100;
        const height = shape === 'round' ? 72 : shape === 'square' ? 74 : shape === 'booth' ? 66 : 62;
        const tableId = await ctx.db.insert('tables', {
          floorPlanId,
          label: `${block.section === 'vip' ? 'VIP' : block.section === 'bar' ? 'B' : 'T'}-${counter}`,
          shape,
          seats: shape === 'booth' ? 6 : shape === 'rect' ? 8 : 4,
          x: block.startX + col * 120,
          y: block.startY + row * 120,
          width,
          height,
          rotation: shape === 'rect' ? 90 : 0,
          section: block.section,
          minSpend: block.section === 'vip' ? 250 : block.section === 'bar' ? 120 : block.section === 'patio' ? 150 : 100,
          isReservable: block.section !== 'bar',
        });
        await ctx.db.insert('tableStates', {
          venueId: args.venueId,
          tableId,
          status: 'available',
          partySize: undefined,
          serverId: undefined,
          toastCheckGuid: undefined,
          seatedAt: undefined,
          lastActivityAt: Date.now(),
          notes: undefined,
        });
        counter += 1;
      }
    }

    return { floorPlanId };
  },
});
