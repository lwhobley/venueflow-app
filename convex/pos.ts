import { internalMutation, mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { getAuthUserId } from '@convex-dev/auth/server';
import type { Doc, Id } from './_generated/dataModel';
import { requirePaidSubscription } from './billing/shared';

type AnyCtx = any;

const posProviderValue = v.union(v.literal('toast'), v.literal('square'), v.literal('clover'), v.literal('generic'));
const posConnectionStatusValue = v.union(v.literal('connected'), v.literal('paused'), v.literal('error'));
const posCheckStatusValue = v.union(v.literal('open'), v.literal('paid'), v.literal('void'));

const posCheckInputValue = v.object({
  externalCheckId: v.string(),
  tableLabel: v.optional(v.string()),
  serverName: v.optional(v.string()),
  guestName: v.optional(v.string()),
  openedAt: v.number(),
  closedAt: v.optional(v.number()),
  subtotalCents: v.number(),
  tipCents: v.number(),
  totalCents: v.number(),
  status: posCheckStatusValue,
  raw: v.optional(v.any()),
});

const posCheckValue = v.object({
  _id: v.id('posChecks'),
  venueId: v.id('venues'),
  provider: posProviderValue,
  externalCheckId: v.string(),
  tableLabel: v.union(v.string(), v.null()),
  serverName: v.union(v.string(), v.null()),
  guestName: v.union(v.string(), v.null()),
  openedAt: v.number(),
  closedAt: v.union(v.number(), v.null()),
  subtotalCents: v.number(),
  tipCents: v.number(),
  totalCents: v.number(),
  status: posCheckStatusValue,
  updatedAt: v.number(),
});

const posConnectionValue = v.object({
  _id: v.id('posConnections'),
  venueId: v.id('venues'),
  provider: posProviderValue,
  externalLocationId: v.union(v.string(), v.null()),
  status: posConnectionStatusValue,
  lastSyncAt: v.union(v.number(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

function canManage(role: string) {
  return role === 'admin' || role === 'owner' || role === 'manager';
}

function assertNotDemo(profile: Doc<'profiles'> | null | undefined) {
  if (profile?.isDemo) throw new Error('Demo mode is read-only. Real changes are disabled for this profile.');
}

function cleanText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

async function getProfile(ctx: AnyCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return await ctx.db.query('profiles').withIndex('by_userId', (q: any) => q.eq('userId', userId)).unique();
}

function mapConnection(connection: Doc<'posConnections'>) {
  return {
    _id: connection._id,
    venueId: connection.venueId,
    provider: connection.provider,
    externalLocationId: connection.externalLocationId ?? null,
    status: connection.status,
    lastSyncAt: connection.lastSyncAt ?? null,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

function mapCheck(check: Doc<'posChecks'>) {
  return {
    _id: check._id,
    venueId: check.venueId,
    provider: check.provider,
    externalCheckId: check.externalCheckId,
    tableLabel: check.tableLabel ?? null,
    serverName: check.serverName ?? null,
    guestName: check.guestName ?? null,
    openedAt: check.openedAt,
    closedAt: check.closedAt ?? null,
    subtotalCents: check.subtotalCents,
    tipCents: check.tipCents,
    totalCents: check.totalCents,
    status: check.status,
    updatedAt: check.updatedAt,
  };
}

async function findGuestByName(ctx: AnyCtx, venueId: Id<'venues'>, guestName: string | undefined) {
  const name = guestName?.trim().toLowerCase();
  if (!name) return null;
  const guests = await ctx.db.query('guests').withIndex('by_venue', (q: any) => q.eq('venueId', venueId)).take(100);
  return guests.find((guest: Doc<'guests'>) => guest.fullName.toLowerCase() === name) ?? null;
}

async function upsertCheck(ctx: AnyCtx, args: { venueId: Id<'venues'>; provider: 'toast' | 'square' | 'clover' | 'generic'; check: any }) {
  const now = Date.now();
  const guest = await findGuestByName(ctx, args.venueId, args.check.guestName);
  const existing = await ctx.db
    .query('posChecks')
    .withIndex('by_venue_provider_external', (q: any) => q.eq('venueId', args.venueId).eq('provider', args.provider).eq('externalCheckId', args.check.externalCheckId))
    .unique();
  const payload = {
    venueId: args.venueId,
    provider: args.provider,
    externalCheckId: args.check.externalCheckId,
    tableLabel: cleanText(args.check.tableLabel),
    serverName: cleanText(args.check.serverName),
    guestName: cleanText(args.check.guestName),
    guestId: guest?._id,
    openedAt: args.check.openedAt,
    closedAt: args.check.closedAt,
    subtotalCents: Math.max(0, Math.round(args.check.subtotalCents)),
    tipCents: Math.max(0, Math.round(args.check.tipCents)),
    totalCents: Math.max(0, Math.round(args.check.totalCents)),
    status: args.check.status,
    raw: args.check.raw,
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, payload);
    const updated = await ctx.db.get(existing._id);
    if (!updated) throw new Error('Unable to update POS check');
    return updated;
  }
  const id: Id<'posChecks'> = await ctx.db.insert('posChecks', payload);
  const created = await ctx.db.get(id);
  if (!created) throw new Error('Unable to create POS check');
  return created;
}

export const getPosOverview = query({
  args: { venueId: v.id('venues') },
  returns: v.union(
    v.null(),
    v.object({
      connections: v.array(posConnectionValue),
      recentChecks: v.array(posCheckValue),
      todaySalesCents: v.number(),
      todayTipsCents: v.number(),
      openChecks: v.number(),
      lastSyncAt: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) return null;
    await requirePaidSubscription(ctx as AnyCtx, args.venueId);
    const connections = await (ctx as AnyCtx).db.query('posConnections').withIndex('by_venue', (q: any) => q.eq('venueId', args.venueId)).take(10);
    const checks = await (ctx as AnyCtx).db.query('posChecks').withIndex('by_venue_openedAt', (q: any) => q.eq('venueId', args.venueId)).order('desc').take(50);
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const todaysChecks = checks.filter((check: Doc<'posChecks'>) => check.openedAt >= dayStart.getTime());
    return {
      connections: connections.map(mapConnection),
      recentChecks: checks.map(mapCheck),
      todaySalesCents: todaysChecks.reduce((sum: number, check: Doc<'posChecks'>) => sum + check.totalCents, 0),
      todayTipsCents: todaysChecks.reduce((sum: number, check: Doc<'posChecks'>) => sum + check.tipCents, 0),
      openChecks: checks.filter((check: Doc<'posChecks'>) => check.status === 'open').length,
      lastSyncAt: connections.reduce((latest: number | null, connection: Doc<'posConnections'>) => {
        if (!connection.lastSyncAt) return latest;
        return latest == null ? connection.lastSyncAt : Math.max(latest, connection.lastSyncAt);
      }, null),
    };
  },
});

export const upsertPosConnection = mutation({
  args: {
    venueId: v.id('venues'),
    provider: posProviderValue,
    externalLocationId: v.optional(v.string()),
    status: posConnectionStatusValue,
  },
  returns: posConnectionValue,
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) throw new Error('Not authorized');
    assertNotDemo(profile);
    await requirePaidSubscription(ctx as AnyCtx, args.venueId);
    const now = Date.now();
    const existing = await (ctx as AnyCtx).db
      .query('posConnections')
      .withIndex('by_venue_and_provider', (q: any) => q.eq('venueId', args.venueId).eq('provider', args.provider))
      .unique();
    const payload = {
      venueId: args.venueId,
      provider: args.provider,
      externalLocationId: cleanText(args.externalLocationId),
      status: args.status,
      updatedAt: now,
    };
    if (existing) {
      await (ctx as AnyCtx).db.patch(existing._id, payload);
      const updated = await (ctx as AnyCtx).db.get(existing._id);
      if (!updated) throw new Error('Unable to update POS connection');
      return mapConnection(updated);
    }
    const id: Id<'posConnections'> = await (ctx as AnyCtx).db.insert('posConnections', { ...payload, createdAt: now });
    const created = await (ctx as AnyCtx).db.get(id);
    if (!created) throw new Error('Unable to create POS connection');
    return mapConnection(created);
  },
});

export const importPosCheck = mutation({
  args: { venueId: v.id('venues'), provider: posProviderValue, check: posCheckInputValue },
  returns: posCheckValue,
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) throw new Error('Not authorized');
    assertNotDemo(profile);
    await requirePaidSubscription(ctx as AnyCtx, args.venueId);
    const check = await upsertCheck(ctx as AnyCtx, args);
    const connection = await (ctx as AnyCtx).db
      .query('posConnections')
      .withIndex('by_venue_and_provider', (q: any) => q.eq('venueId', args.venueId).eq('provider', args.provider))
      .unique();
    if (connection) await (ctx as AnyCtx).db.patch(connection._id, { lastSyncAt: Date.now(), status: 'connected', updatedAt: Date.now() });
    return mapCheck(check);
  },
});

export const ingestPosCheck = internalMutation({
  args: { venueId: v.id('venues'), provider: posProviderValue, check: posCheckInputValue },
  returns: posCheckValue,
  handler: async (ctx, args) => {
    // Only accept webhook writes for venues that have configured this provider.
    const connection = await (ctx as AnyCtx).db
      .query('posConnections')
      .withIndex('by_venue_and_provider', (q: any) => q.eq('venueId', args.venueId).eq('provider', args.provider))
      .unique();
    if (!connection) throw new Error('No POS connection configured for this venue/provider');
    const check = await upsertCheck(ctx as AnyCtx, args);
    await (ctx as AnyCtx).db.patch(connection._id, { lastSyncAt: Date.now(), status: 'connected', updatedAt: Date.now() });
    return mapCheck(check);
  },
});
