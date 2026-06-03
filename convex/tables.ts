import { mutation } from './_generated/server';
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { requireActiveSubscription } from './billing/shared';
import { getAuthUserId } from '@convex-dev/auth/server';

const tableStatus = v.union(
  v.literal('available'),
  v.literal('seated'),
  v.literal('dirty'),
  v.literal('reserved'),
  v.literal('held'),
  v.literal('out_of_service'),
);

async function requireProfile(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error('Unauthenticated');
  const profile = await ctx.db.query('profiles').withIndex('by_userId', (q: any) => q.eq('userId', userId)).unique();
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
  return await ctx.db.query('tableStates').withIndex('by_table', (q: any) => q.eq('tableId', tableId)).first();
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
  // Deny if the caller has no venue, or belongs to a different venue.
  // (A falsy venueId previously skipped this check entirely — a cross-venue hole.)
  if (!profile.venueId || profile.venueId !== floorPlan.venueId) throw new Error('Table is outside your venue');

  const current = await loadState(ctx, tableId);
  if (profile.role === 'server' && current?.serverId && current.serverId !== profile._id) {
    throw new Error('Servers can only update their own tables');
  }

  const now = Date.now();
  const nextStatus = patch.status ?? current?.status ?? 'available';
  const previousStatus = current?.status ?? 'available';
  const isSeated = nextStatus === 'seated';
  const isLeavingSeated = previousStatus === 'seated' && nextStatus !== 'seated';
  // tableStates optional fields are v.optional (undefined when empty) — never
  // null, which the schema rejects.
  const clearedStatus = nextStatus === 'available' || nextStatus === 'dirty' || nextStatus === 'out_of_service';
  const nextState = {
    venueId: floorPlan.venueId,
    tableId,
    status: nextStatus,
    partySize: patch.partySize ?? (clearedStatus ? undefined : current?.partySize ?? undefined),
    serverId: patch.serverId ?? (clearedStatus ? undefined : current?.serverId ?? profile._id),
    toastCheckGuid: patch.toastCheckGuid ?? current?.toastCheckGuid ?? undefined,
    seatedAt: isSeated ? current?.seatedAt ?? now : undefined,
    lastActivityAt: now,
    notes: patch.notes ?? current?.notes ?? undefined,
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
      partySize: undefined,
      serverId: undefined,
      notes: undefined,
      toastCheckGuid: undefined,
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
      notes: source.notes ?? undefined,
    });
    await applyUpdate(ctx, profile, args.fromTableId, { status: 'dirty', partySize: undefined, serverId: undefined, notes: undefined, toastCheckGuid: undefined });
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
      await applyUpdate(ctx, profile, tableId, { status: 'held', notes: 'Merged into primary table', partySize: undefined, serverId: undefined });
    }
    return null;
  },
});

// Merge several tables into one big-party group (all seated, sharing a
// mergeGroupId). Written as direct upserts so the group id survives.
export const mergeTablesForParty = mutation({
  args: { venueId: v.id('venues'), tableIds: v.array(v.id('tables')), partySize: v.number(), serverId: v.optional(v.id('profiles')) },
  returns: v.object({ mergeGroupId: v.string() }),
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (!canTransfer(profile.role)) throw new Error('Not authorized');
    if (profile.venueId !== args.venueId) throw new Error('Table is outside your venue');
    await requireActiveSubscription(ctx as any, args.venueId);
    if (args.tableIds.length < 2) throw new Error('Pick at least two tables to merge');

    const groupId = `mg_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const now = Date.now();
    for (const tableId of args.tableIds) {
      const { floorPlan } = await loadTableAndPlan(ctx, tableId);
      if (floorPlan.venueId !== args.venueId) throw new Error('Table is outside your venue');
      const state = await loadState(ctx, tableId);
      const next = {
        venueId: args.venueId,
        tableId,
        status: 'seated' as const,
        partySize: Math.max(1, Math.round(args.partySize)),
        serverId: args.serverId ?? profile._id,
        toastCheckGuid: state?.toastCheckGuid ?? undefined,
        seatedAt: state?.seatedAt ?? now,
        lastActivityAt: now,
        notes: 'Merged party',
        mergeGroupId: groupId,
      };
      if (state) await ctx.db.patch(state._id, next);
      else await ctx.db.insert('tableStates', next);
      await writeHistory(ctx, { tableId, venueId: args.venueId, fromStatus: state?.status ?? 'available', toStatus: 'seated', actorId: profile._id, partySize: next.partySize, metadata: { merge: groupId } });
    }
    return { mergeGroupId: groupId };
  },
});

export const splitMergedTables = mutation({
  args: { venueId: v.id('venues'), mergeGroupId: v.string() },
  returns: v.object({ freed: v.number() }),
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (!canTransfer(profile.role)) throw new Error('Not authorized');




    if (profile.venueId !== args.venueId) throw new Error('Table is outside your venue');
    await requireActiveSubscription(ctx as any, args.venueId);
    const group = await ctx.db
      .query('tableStates')
      .withIndex('by_venue_merge_group', (q: any) => q.eq('venueId', args.venueId).eq('mergeGroupId', args.mergeGroupId))
      .take(50);
    const now = Date.now();
    for (const s of group) {
      await ctx.db.patch(s._id, { status: 'available', partySize: undefined, serverId: undefined, seatedAt: undefined, notes: undefined, mergeGroupId: undefined, lastActivityAt: now });
      await writeHistory(ctx, { tableId: s.tableId, venueId: args.venueId, fromStatus: s.status, toStatus: 'available', actorId: profile._id, partySize: null, metadata: { split: args.mergeGroupId } });
    }
    return { freed: group.length };
  },
});
