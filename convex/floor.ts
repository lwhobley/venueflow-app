import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';

// Import for billing check
import { requireActiveSubscription } from './billing/shared';
import { getAuthUserId } from '@convex-dev/auth/server';

const tableShape = v.union(v.literal('round'), v.literal('square'), v.literal('rect'), v.literal('booth'));
const tableSection = v.union(v.literal('main'), v.literal('patio'), v.literal('bar'), v.literal('vip'));
const tableStatus = v.union(
  v.literal('available'),
  v.literal('seated'),
  v.literal('dirty'),
  v.literal('reserved'),
  v.literal('held'),
  v.literal('out_of_service'),
);

const floorPlanValue = v.object({
  _id: v.id('floorPlans'),
  _creationTime: v.number(),
  venueId: v.id('venues'),
  name: v.string(),
  width: v.number(),
  height: v.number(),
  backgroundImageUrl: v.union(v.string(), v.null()),
  isActive: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const tableValue = v.object({
  _id: v.id('tables'),
  _creationTime: v.number(),
  floorPlanId: v.id('floorPlans'),
  label: v.string(),
  shape: tableShape,
  seats: v.number(),
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number(),
  rotation: v.number(),
  section: tableSection,
  minSpend: v.number(),
  isReservable: v.boolean(),
});

const tableStateValue = v.object({
  _id: v.id('tableStates'),
  _creationTime: v.number(),
  venueId: v.id('venues'),
  tableId: v.id('tables'),
  status: tableStatus,
  partySize: v.union(v.number(), v.null()),
  serverId: v.union(v.id('profiles'), v.null()),
  toastCheckGuid: v.union(v.string(), v.null()),
  seatedAt: v.union(v.number(), v.null()),
  lastActivityAt: v.number(),
  notes: v.union(v.string(), v.null()),
});

const floorTableValue = v.object({
  table: tableValue,
  state: v.union(tableStateValue, v.null()),
});

const floorStatsValue = v.object({
  occupiedCount: v.number(),
  avgTurnTimeMinutes: v.number(),
  longestSeatedDurationMinutes: v.number(),
  waitlistSize: v.number(),
  availableCount: v.number(),
  dirtyCount: v.number(),
  reservedCount: v.number(),
  heldCount: v.number(),
  outOfServiceCount: v.number(),
});

const floorHistoryValue = v.object({
  _id: v.id('tableStateHistory'),
  _creationTime: v.number(),
  venueId: v.id('venues'),
  tableId: v.id('tables'),
  fromStatus: tableStatus,
  toStatus: tableStatus,
  actorId: v.union(v.id('profiles'), v.null()),
  partySize: v.union(v.number(), v.null()),
  timestamp: v.number(),
  metadata: v.union(v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.null())), v.null()),
});

function canManageFloor(role: Doc<'profiles'>['role']) {
  return role === 'admin' || role === 'owner';
}

async function requireProfile(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error('Unauthenticated');
  const profile = await ctx.db.query('profiles').withIndex('by_userId', (q: any) => q.eq('userId', userId)).unique();
  if (!profile) throw new Error('Profile not found');
  return profile as Doc<'profiles'>;
}

// Ensures the caller belongs to `venueId` before returning venue-scoped data.
async function requireVenueMember(ctx: any, venueId: string) {
  const profile = await requireProfile(ctx);
  if (!profile.venueId || profile.venueId !== venueId) throw new Error('Resource is outside your venue');
  return profile;
}

async function loadFloorPlan(ctx: any, venueId: string) {
  return await ctx.db.query('floorPlans').withIndex('by_venue_active', (q: any) => q.eq('venueId', venueId).eq('isActive', true)).unique();
}

async function loadState(ctx: any, tableId: Doc<'tables'>['_id']) {
  return await ctx.db.query('tableStates').withIndex('by_table', (q: any) => q.eq('tableId', tableId)).unique();
}

export const getActiveFloorPlan = query({
  args: { venueId: v.id('venues') },
  returns: v.union(v.null(), v.object({ floorPlan: floorPlanValue, tables: v.array(floorTableValue) })),
  handler: async (ctx, args) => {
    await requireVenueMember(ctx, args.venueId);
    const plan = await loadFloorPlan(ctx, args.venueId);
    if (!plan) return null;
    const tables = await ctx.db.query('tables').withIndex('by_floor_plan', (q: any) => q.eq('floorPlanId', plan._id)).collect();
    const view: Array<{ table: Doc<'tables'>; state: Doc<'tableStates'> | null }> = [];
    for (const table of tables) {
      view.push({ table, state: await loadState(ctx, table._id) });
    }
    return {
      floorPlan: {
        _id: plan._id,
        _creationTime: plan._creationTime,
        venueId: plan.venueId,
        name: plan.name,
        width: plan.width,
        height: plan.height,
        backgroundImageUrl: plan.backgroundImageUrl ?? null,
        isActive: plan.isActive,
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
      },
      tables: view.map(({ table, state }) => ({
        table: {
          _id: table._id,
          _creationTime: table._creationTime,
          floorPlanId: table.floorPlanId,
          label: table.label,
          shape: table.shape,
          seats: table.seats,
          x: table.x,
          y: table.y,
          width: table.width,
          height: table.height,
          rotation: table.rotation,
          section: table.section,
          minSpend: table.minSpend,
          isReservable: table.isReservable,
        },
        state: state
          ? {
              _id: state._id,
              _creationTime: state._creationTime,
              venueId: state.venueId,
              tableId: state.tableId,
              status: state.status,
              partySize: state.partySize ?? null,
              serverId: state.serverId ?? null,
              toastCheckGuid: state.toastCheckGuid ?? null,
              seatedAt: state.seatedAt ?? null,
              lastActivityAt: state.lastActivityAt,
              notes: state.notes ?? null,
            }
          : null,
      })),
    };
  },
});

export const getFloorStats = query({
  args: { venueId: v.id('venues') },
  returns: floorStatsValue,
  handler: async (ctx, args) => {
    await requireVenueMember(ctx, args.venueId);
    const plan = await loadFloorPlan(ctx, args.venueId);
    if (!plan) {
      return {
        occupiedCount: 0,
        avgTurnTimeMinutes: 0,
        longestSeatedDurationMinutes: 0,
        waitlistSize: 0,
        availableCount: 0,
        dirtyCount: 0,
        reservedCount: 0,
        heldCount: 0,
        outOfServiceCount: 0,
      };
    }

    const tables = await ctx.db.query('tables').withIndex('by_floor_plan', (q: any) => q.eq('floorPlanId', plan._id)).collect();
    const states: Doc<'tableStates'>[] = [];
    for (const table of tables) {
      const state = await loadState(ctx, table._id);
      if (state) states.push(state);
    }

    const history = await ctx.db.query('tableStateHistory').withIndex('by_venue_time', (q: any) => q.eq('venueId', args.venueId)).order('desc').take(60);
    const turnTimes = history
      .map((item: Doc<'tableStateHistory'>) => Number(item.metadata?.turnTimeMinutes ?? 0))
      .filter((value: number) => value > 0);
    const seatedDurations = states
      .filter((state: Doc<'tableStates'>) => state.status === 'seated' && state.seatedAt)
      .map((state: Doc<'tableStates'>) => Math.max(0, Math.round((Date.now() - Number(state.seatedAt)) / 60000)));

    return {
      occupiedCount: states.filter((state: Doc<'tableStates'>) => state.status === 'seated').length,
      avgTurnTimeMinutes: turnTimes.length ? Math.round(turnTimes.reduce((sum: number, value: number) => sum + value, 0) / turnTimes.length) : 0,
      longestSeatedDurationMinutes: seatedDurations.length ? Math.max(...seatedDurations) : 0,
      waitlistSize: states.filter((state: Doc<'tableStates'>) => state.status === 'reserved' || state.status === 'held').length,
      availableCount: states.filter((state: Doc<'tableStates'>) => state.status === 'available').length,
      dirtyCount: states.filter((state: Doc<'tableStates'>) => state.status === 'dirty').length,
      reservedCount: states.filter((state: Doc<'tableStates'>) => state.status === 'reserved').length,
      heldCount: states.filter((state: Doc<'tableStates'>) => state.status === 'held').length,
      outOfServiceCount: states.filter((state: Doc<'tableStates'>) => state.status === 'out_of_service').length,
    };
  },
});

export const getTableHistory = query({
  args: { tableId: v.id('tables'), limit: v.number() },
  returns: v.array(floorHistoryValue),
  handler: async (ctx, args) => {
    const table = await ctx.db.get(args.tableId);
    if (!table) return [];
    const plan = await ctx.db.get(table.floorPlanId);
    if (!plan) return [];
    await requireVenueMember(ctx, plan.venueId);

    const history = await ctx.db.query('tableStateHistory').withIndex('by_table_time', (q: any) => q.eq('tableId', args.tableId)).order('desc').take(Math.max(1, Math.min(args.limit, 50)));
    return history.map((item: Doc<'tableStateHistory'>) => ({
      _id: item._id,
      _creationTime: item._creationTime,
      venueId: item.venueId,
      tableId: item.tableId,
      fromStatus: item.fromStatus,
      toStatus: item.toStatus,
      actorId: item.actorId ?? null,
      partySize: item.partySize ?? null,
      timestamp: item.timestamp,
      metadata: item.metadata ?? null,
    }));
  },
});

export const saveFloorPlan = mutation({
  args: {
    venueId: v.id('venues'),
    name: v.string(),
    width: v.number(),
    height: v.number(),
    backgroundImageUrl: v.union(v.string(), v.null()),
    tables: v.array(
      v.object({
        label: v.string(),
        shape: tableShape,
        seats: v.number(),
        x: v.number(),
        y: v.number(),
        width: v.number(),
        height: v.number(),
        rotation: v.number(),
        section: tableSection,
        minSpend: v.number(),
        isReservable: v.boolean(),
      }),
    ),
  },
  returns: v.object({ floorPlanId: v.id('floorPlans') }),
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (!canManageFloor(profile.role)) throw new Error('Admin access required');

    // Require active billing subscription
    await requireActiveSubscription(ctx as any, args.venueId);

    if (!profile.venueId || profile.venueId !== args.venueId) throw new Error('Profile does not belong to this venue');

    const existing = await loadFloorPlan(ctx, args.venueId);
    if (existing) await ctx.db.patch(existing._id, { isActive: false, updatedAt: Date.now() });

    const floorPlanId = await ctx.db.insert('floorPlans', {
      venueId: args.venueId,
      name: args.name,
      width: args.width,
      height: args.height,
      backgroundImageUrl: args.backgroundImageUrl ?? null,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    for (const table of args.tables) {
      const tableId = await ctx.db.insert('tables', {
        floorPlanId,
        label: table.label,
        shape: table.shape,
        seats: table.seats,
        x: table.x,
        y: table.y,
        width: table.width,
        height: table.height,
        rotation: table.rotation,
        section: table.section,
        minSpend: table.minSpend,
        isReservable: table.isReservable,
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
    }

    return { floorPlanId };
  },
});