import { mutation } from './_generated/server';
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { requireActiveSubscription } from './billing/shared';

const tableStatus = v.union(
  v.literal('available'),
  v.literal('seated'),
  v.literal('dirty'),
  v.literal('reserved'),
  v.literal('held'),
  v.literal('out_of_service'),
);

async function requireProfile(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error('Unauthenticated');
  const profile = await ctx.db.query('profiles').withIndex('by_tokenIdentifier', (q: any) => q.eq('tokenIdentifier', identity.tokenIdentifier)).unique();
  if (!profile) throw new Error('Profile not found');
  return profile as Doc<'profiles'>;
}

function canOperate(role: Doc<'profiles'>['role']) {
  return role === 'admin' || role === 'owner' || role === 'manager' || role === 'server';
}

function canTransfer(role: Doc<'profiles'>['role']) {
  return role === 'admin' || role === 'owner' || role === 'manager';
}

async function loadState(ctx: any, tableId: Id<'tables'>) {
  return await ctx.db.query('tableStates').withIndex('by_table', (q: any) => q.eq('tableId', tableId)).unique();
}

async function loadTableAndPlan(ctx: any, tableId: Id<'tables'>) {
  const table = await ctx.db.get(tableId);
  if (!table) throw new Error('Table not found');
  const floorPlan = await ctx.db.get(table.floorPlanId);
  if (!floorPlan) throw new Error('Floor plan not found');
  return { table, floorPlan };
}

async function writeHistory(
  ctx: any,
  payload: {
    tableId: Id<'tables'>;
    venueId: string;
    fromStatus: Doc<'tableStates'>['status'];
    toStatus: Doc<'tableStates'>['status'];
    actorId: Id<'profiles'> | null;
    partySize: number | null;
    metadata: Record<string, string | number | boolean | null> | null;
  },
) {
  await ctx.db.insert('tableStateHistory', {
    tableId: payload.tableId,
    venueId: payload.venueId,
    fromStatus: payload.fromStatus,
    toStatus: payload.toStatus,
    actorId: payload.actorId ?? undefined,
    partySize: payload.partySize ?? undefined,
    timestamp: Date.now(),
    metadata: payload.metadata ?? undefined,
  });
}

async function applyUpdate(
  ctx: any,
  profile: Doc<'profiles'>,
  tableId: Id<'tables'>,
  patch: Partial<Pick<Doc<'tableStates'>, 'status' | 'partySize' | 'serverId' | 'toastCheckGuid' | 'seatedAt' | 'lastActivityAt' | 'notes'>>,
) {
  const { table, floorPlan } = await loadTableAndPlan(ctx, tableId);
  if (profile.venueId && profile.venueId !== floorPlan.venueId) throw new Error('Table is outside your venue');

  const current = await loadState(ctx, tableId);
  if (profile.role === 'server' && current?.serverId && current.serverId !== profile._id) {
    throw new Error('Servers can only update their own tables');
  }

  const now = Date.now();
  const nextStatus = patch.status ?? current?.status ?? 'available';
  const previousStatus = current?.status ?? 'available';
  const isSeated = nextStatus === 'seated';
  const isLeavingSeated = previousStatus === 'seated' && nextStatus !== 'seated';
  const nextState = {
    venueId: floorPlan.venueId,
    tableId,
    status: nextStatus,
    partySize: patch.partySize ?? (isSeated ? current?.partySize ?? null : nextStatus === 'available' || nextStatus === 'dirty' || nextStatus === 'out_of_service' ? null : current?.partySize ?? null),
    serverId: patch.serverId ?? (nextStatus === 'available' || nextStatus === 'dirty' || nextStatus === 'out_of_service' ? null : current?.serverId ?? profile._id),
    toastCheckGuid: patch.toastCheckGuid ?? current?.toastCheckGuid ?? null,
    seatedAt: isSeated ? current?.seatedAt ?? now : null,
    lastActivityAt: now,
    notes: patch.notes ?? current?.notes ?? null,
  };

  if (current) await ctx.db.patch(current._id, nextState);
  else await ctx.db.insert('tableStates', nextState);

  await writeHistory(ctx, {
    tableId,
    venueId: floorPlan.venueId,
    fromStatus: previousStatus,
    toStatus: nextStatus,
    actorId: profile._id,
    partySize: nextState.partySize ?? null,
    metadata: isLeavingSeated && current?.seatedAt ? { turnTimeMinutes: Math.max(0, Math.round((now - current.seatedAt) / 60000)), tableLabel: table.label } : { tableLabel: table.label },
  });
}

export const updateTableState = mutation({
  args: {
    tableId: v.id('tables'),
    status: tableStatus,
    partySize: v.optional(v.number()),
    serverId: v.optional(v.id('profiles')),
    notes: v.optional(v.string()),
    toastCheckGuid: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (!canOperate(profile.role)) throw new Error('Not authorized');
    await requireActiveSubscription(ctx as any, (await loadTableAndPlan(ctx, args.tableId)).floorPlan.venueId);
    await applyUpdate(ctx, profile, args.tableId, args);
    return null;
  },
});

export const seatParty = mutation({
  args: { tableId: v.id('tables'), partySize: v.number(), serverId: v.optional(v.id('profiles')) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (!canOperate(profile.role)) throw new Error('Not authorized');
    const { floorPlan } = await loadTableAndPlan(ctx, args.tableId);
    await requireActiveSubscription(ctx as any, floorPlan.venueId);
    await applyUpdate(ctx, profile, args.tableId, { status: 'seated', partySize: args.partySize, serverId: args.serverId ?? profile._id });
    return null;
  },
});

export const markDirty = mutation({
  args: { tableId: v.id('tables') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (!canOperate(profile.role)) throw new Error('Not authorized');
    const { floorPlan } = await loadTableAndPlan(ctx, args.tableId);
    await requireActiveSubscription(ctx as any, floorPlan.venueId);
    await applyUpdate(ctx, profile, args.tableId, { status: 'dirty' });
    return null;
  },
});

export const markClean = mutation({
  args: { tableId: v.id('tables') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (!canOperate(profile.role)) throw new Error('Not authorized');
    const { floorPlan } = await loadTableAndPlan(ctx, args.tableId);
    await requireActiveSubscription(ctx as any, floorPlan.venueId);
    await applyUpdate(ctx, profile, args.tableId, {
      status: 'available',
      partySize: null,
      serverId: null,
      notes: null,
      toastCheckGuid: null,
    });
    return null;
  },
});

export const transferTable = mutation({
  args: { fromTableId: v.id('tables'), toTableId: v.id('tables'), actorId: v.id('profiles') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (!canTransfer(profile.role)) throw new Error('Not authorized');
    const source = await loadState(ctx, args.fromTableId);
    if (!source || source.status !== 'seated') throw new Error('Source table is not seated');
    const { floorPlan } = await loadTableAndPlan(ctx, args.toTableId);
    await requireActiveSubscription(ctx as any, floorPlan.venueId);
    await applyUpdate(ctx, profile, args.toTableId, {
      status: 'seated',
      partySize: source.partySize ?? 0,
      serverId: source.serverId ?? args.actorId,
      notes: source.notes ?? null,
    });
    await applyUpdate(ctx, profile, args.fromTableId, { status: 'dirty', partySize: null, serverId: null, notes: null, toastCheckGuid: null });
    return null;
  },
});

export const mergeTables = mutation({
  args: { primaryTableId: v.id('tables'), mergeTableIds: v.array(v.id('tables')), actorId: v.id('profiles') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (!canTransfer(profile.role)) throw new Error('Not authorized');
    const primary = await loadState(ctx, args.primaryTableId);
    if (!primary) throw new Error('Primary table not found');
    const { floorPlan } = await loadTableAndPlan(ctx, args.primaryTableId);
    await requireActiveSubscription(ctx as any, floorPlan.venueId);
    const totalGuests = (primary.partySize ?? 0) + args.mergeTableIds.length;
    await applyUpdate(ctx, profile, args.primaryTableId, { status: 'seated', partySize: totalGuests, serverId: primary.serverId ?? args.actorId });
    for (const tableId of args.mergeTableIds) {
      await applyUpdate(ctx, profile, tableId, { status: 'held', notes: 'Merged into primary table', partySize: null, serverId: null });
    }
    return null;
  },
});