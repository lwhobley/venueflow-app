import { internalMutation, mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { getAuthUserId } from '@convex-dev/auth/server';
import type { Doc, Id } from './_generated/dataModel';
import { requirePaidSubscription } from './billing/shared';

type AnyCtx = any;

const posProviderValue = v.union(v.literal('toast'), v.literal('square'), v.literal('clover'), v.literal('generic'));
const posConnectionStatusValue = v.union(v.literal('connected'), v.literal('paused'), v.literal('error'));
const posCheckStatusValue = v.union(v.literal('open'), v.literal('paid'), v.literal('void'));

const menuItemInputValue = v.object({
  name: v.string(),
  category: v.optional(v.string()),
  quantity: v.number(),
  priceCents: v.number(),
});

const posCheckInputValue = v.object({
  externalCheckId: v.string(),
  tableLabel: v.optional(v.string()),
  serverName: v.optional(v.string()),
  guestName: v.optional(v.string()),
  guestCount: v.optional(v.number()),
  revenueCenter: v.optional(v.string()),
  tenderType: v.optional(v.string()),
  openedAt: v.number(),
  closedAt: v.optional(v.number()),
  subtotalCents: v.number(),
  taxCents: v.optional(v.number()),
  tipCents: v.number(),
  totalCents: v.number(),
  discountCents: v.optional(v.number()),
  compCents: v.optional(v.number()),
  promoCents: v.optional(v.number()),
  menuItems: v.optional(v.array(menuItemInputValue)),
  status: posCheckStatusValue,
  raw: v.optional(v.any()),
});

const posLaborPunchInputValue = v.object({
  externalEmployeeId: v.string(),
  employeeName: v.string(),
  jobTitle: v.optional(v.string()),
  clockInAt: v.number(),
  clockOutAt: v.optional(v.number()),
  regularMinutes: v.optional(v.number()),
  overtimeMinutes: v.optional(v.number()),
  declaredTipsCents: v.optional(v.number()),
  tipsCents: v.optional(v.number()),
  regularPayCents: v.optional(v.number()),
  overtimePayCents: v.optional(v.number()),
  totalPayCents: v.optional(v.number()),
  businessDate: v.string(),
});

const posCheckValue = v.object({
  _id: v.id('posChecks'),
  venueId: v.id('venues'),
  provider: posProviderValue,
  externalCheckId: v.string(),
  tableLabel: v.union(v.string(), v.null()),
  serverName: v.union(v.string(), v.null()),
  guestName: v.union(v.string(), v.null()),
  guestCount: v.union(v.number(), v.null()),
  revenueCenter: v.union(v.string(), v.null()),
  tenderType: v.union(v.string(), v.null()),
  openedAt: v.number(),
  closedAt: v.union(v.number(), v.null()),
  subtotalCents: v.number(),
  taxCents: v.union(v.number(), v.null()),
  tipCents: v.number(),
  totalCents: v.number(),
  discountCents: v.union(v.number(), v.null()),
  compCents: v.union(v.number(), v.null()),
  promoCents: v.union(v.number(), v.null()),
  menuItems: v.union(v.array(v.object({ name: v.string(), category: v.union(v.string(), v.null()), quantity: v.number(), priceCents: v.number() })), v.null()),
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

// Secret-bearing shape returned once at create/rotate; never via reads.
const posConnectionWithSecretValue = v.object({
  _id: v.id('posConnections'),
  venueId: v.id('venues'),
  provider: posProviderValue,
  externalLocationId: v.union(v.string(), v.null()),
  status: posConnectionStatusValue,
  webhookSecret: v.union(v.string(), v.null()),
  lastSyncAt: v.union(v.number(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

function secretsMatch(a: string | undefined | null, b: string | undefined | null) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function newWebhookSecret() {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '').slice(0, 40);
}

function canManage(role: string) {
  return role === 'admin' || role === 'owner' || role === 'manager';
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
    guestCount: check.guestCount ?? null,
    revenueCenter: check.revenueCenter ?? null,
    tenderType: check.tenderType ?? null,
    openedAt: check.openedAt,
    closedAt: check.closedAt ?? null,
    subtotalCents: check.subtotalCents,
    taxCents: check.taxCents ?? null,
    tipCents: check.tipCents,
    totalCents: check.totalCents,
    discountCents: check.discountCents ?? null,
    compCents: check.compCents ?? null,
    promoCents: check.promoCents ?? null,
    menuItems: check.menuItems
      ? check.menuItems.map((it) => ({ name: it.name, category: it.category ?? null, quantity: it.quantity, priceCents: it.priceCents }))
      : null,
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
  const c = args.check;
  const payload = {
    venueId: args.venueId,
    provider: args.provider,
    externalCheckId: c.externalCheckId,
    tableLabel: cleanText(c.tableLabel),
    serverName: cleanText(c.serverName),
    guestName: cleanText(c.guestName),
    guestId: guest?._id,
    guestCount: typeof c.guestCount === 'number' ? Math.max(0, Math.round(c.guestCount)) : undefined,
    revenueCenter: cleanText(c.revenueCenter),
    tenderType: cleanText(c.tenderType),
    openedAt: c.openedAt,
    closedAt: c.closedAt,
    subtotalCents: Math.max(0, Math.round(c.subtotalCents)),
    taxCents: typeof c.taxCents === 'number' ? Math.max(0, Math.round(c.taxCents)) : undefined,
    tipCents: Math.max(0, Math.round(c.tipCents)),
    totalCents: Math.max(0, Math.round(c.totalCents)),
    discountCents: typeof c.discountCents === 'number' ? Math.max(0, Math.round(c.discountCents)) : undefined,
    compCents: typeof c.compCents === 'number' ? Math.max(0, Math.round(c.compCents)) : undefined,
    promoCents: typeof c.promoCents === 'number' ? Math.max(0, Math.round(c.promoCents)) : undefined,
    menuItems: Array.isArray(c.menuItems)
      ? c.menuItems.map((it: any) => ({
          name: String(it.name).slice(0, 200),
          category: it.category ? String(it.category).slice(0, 100) : undefined,
          quantity: Math.max(0, Number(it.quantity)),
          priceCents: Math.max(0, Math.round(Number(it.priceCents))),
        }))
      : undefined,
    status: c.status,
    raw: c.raw,
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

// ---------- Sales analytics helpers ----------

function dayBounds(offsetDays: number) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(0, 0, 0, 0);
  return { start: d.getTime(), end: d.getTime() + 86_400_000 };
}

function isoDate(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Aggregate check-level fields into a running summary object.
function accumulateCheck(acc: {
  salesCents: number; taxCents: number; tipCents: number;
  discountCents: number; compCents: number; promoCents: number;
  checkCount: number; coverCount: number;
}, c: Doc<'posChecks'>) {
  acc.salesCents += c.totalCents;
  acc.taxCents += c.taxCents ?? 0;
  acc.tipCents += c.tipCents;
  acc.discountCents += c.discountCents ?? 0;
  acc.compCents += c.compCents ?? 0;
  acc.promoCents += c.promoCents ?? 0;
  acc.checkCount += 1;
  acc.coverCount += c.guestCount ?? 1;
}

// ---------- Queries ----------

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
    const { start: dayStart } = dayBounds(0);
    const todaysChecks = checks.filter((c: Doc<'posChecks'>) => c.openedAt >= dayStart);
    return {
      connections: connections.map(mapConnection),
      recentChecks: checks.map(mapCheck),
      todaySalesCents: todaysChecks.reduce((s: number, c: Doc<'posChecks'>) => s + c.totalCents, 0),
      todayTipsCents: todaysChecks.reduce((s: number, c: Doc<'posChecks'>) => s + c.tipCents, 0),
      openChecks: checks.filter((c: Doc<'posChecks'>) => c.status === 'open').length,
      lastSyncAt: connections.reduce((latest: number | null, conn: Doc<'posConnections'>) => {
        if (!conn.lastSyncAt) return latest;
        return latest == null ? conn.lastSyncAt : Math.max(latest, conn.lastSyncAt);
      }, null),
    };
  },
});

const salesSummaryValue = v.object({
  salesCents: v.number(),
  taxCents: v.number(),
  tipCents: v.number(),
  discountCents: v.number(),
  compCents: v.number(),
  promoCents: v.number(),
  checkCount: v.number(),
  coverCount: v.number(),
  avgCheckCents: v.number(),
  avgCheckTimeMins: v.union(v.number(), v.null()),
});

const salesByDayValue = v.object({
  date: v.string(),
  salesCents: v.number(),
  checkCount: v.number(),
  coverCount: v.number(),
});

const salesByRevenueCenterValue = v.object({
  revenueCenter: v.string(),
  salesCents: v.number(),
  checkCount: v.number(),
  coverCount: v.number(),
});

const salesByTenderValue = v.object({
  tenderType: v.string(),
  salesCents: v.number(),
  checkCount: v.number(),
});

const salesSummaryDashboardValue = v.object({
  summary: salesSummaryValue,
  byDay: v.array(salesByDayValue),
  byTender: v.array(salesByTenderValue),
  byRevenueCenter: v.array(salesByRevenueCenterValue),
});

export const getSalesSummary = query({
  args: {
    venueId: v.id('venues'),
    // Number of days back from today. 0 = today, 1 = yesterday, 7 = last 7 days.
    windowDays: v.number(),
  },
  returns: v.union(v.null(), salesSummaryValue),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) return null;
    await requirePaidSubscription(ctx as AnyCtx, args.venueId);

    const window = Math.min(Math.max(1, Math.round(args.windowDays)), 90);
    const { start } = dayBounds(-window + 1);
    const end = dayBounds(1).start; // midnight tonight

    const checks = await (ctx as AnyCtx).db
      .query('posChecks')
      .withIndex('by_venue_openedAt', (q: any) => q.eq('venueId', args.venueId).gte('openedAt', start).lt('openedAt', end))
      .order('asc')
      .take(5000);

    const paid = (checks as Doc<'posChecks'>[]).filter((c) => c.status !== 'void');
    const acc = { salesCents: 0, taxCents: 0, tipCents: 0, discountCents: 0, compCents: 0, promoCents: 0, checkCount: 0, coverCount: 0 };
    let totalTimeMins = 0;
    let timedChecks = 0;
    for (const c of paid) {
      accumulateCheck(acc, c);
      if (c.closedAt) {
        totalTimeMins += (c.closedAt - c.openedAt) / 60_000;
        timedChecks += 1;
      }
    }
    return {
      ...acc,
      avgCheckCents: acc.checkCount ? Math.round(acc.salesCents / acc.checkCount) : 0,
      avgCheckTimeMins: timedChecks ? Math.round(totalTimeMins / timedChecks) : null,
    };
  },
});

export const getSalesSummaryDashboard = query({
  args: {
    venueId: v.id('venues'),
    windowDays: v.number(),
  },
  returns: v.union(v.null(), salesSummaryDashboardValue),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) return null;
    await requirePaidSubscription(ctx as AnyCtx, args.venueId);

    const window = Math.min(Math.max(1, Math.round(args.windowDays)), 90);
    const { start } = dayBounds(-window + 1);
    const end = dayBounds(1).start;

    const checks = (await (ctx as AnyCtx).db
      .query('posChecks')
      .withIndex('by_venue_openedAt', (q: any) => q.eq('venueId', args.venueId).gte('openedAt', start).lt('openedAt', end))
      .order('asc')
      .take(5000)) as Doc<'posChecks'>[];

    const acc = { salesCents: 0, taxCents: 0, tipCents: 0, discountCents: 0, compCents: 0, promoCents: 0, checkCount: 0, coverCount: 0 };
    const byDay = new Map<string, { salesCents: number; checkCount: number; coverCount: number }>();
    const byTender = new Map<string, { salesCents: number; checkCount: number }>();
    const byRevenueCenter = new Map<string, { salesCents: number; checkCount: number; coverCount: number }>();
    let totalTimeMins = 0;
    let timedChecks = 0;

    for (const check of checks) {
      if (check.status === 'void') continue;
      accumulateCheck(acc, check);
      if (check.closedAt) {
        totalTimeMins += (check.closedAt - check.openedAt) / 60_000;
        timedChecks += 1;
      }

      const date = isoDate(check.openedAt);
      const dayRow = byDay.get(date) ?? { salesCents: 0, checkCount: 0, coverCount: 0 };
      dayRow.salesCents += check.totalCents;
      dayRow.checkCount += 1;
      dayRow.coverCount += check.guestCount ?? 1;
      byDay.set(date, dayRow);

      const tender = check.tenderType?.trim() || 'Unknown';
      const tenderRow = byTender.get(tender) ?? { salesCents: 0, checkCount: 0 };
      tenderRow.salesCents += check.totalCents;
      tenderRow.checkCount += 1;
      byTender.set(tender, tenderRow);

      const revenueCenter = check.revenueCenter?.trim() || 'Default';
      const revenueCenterRow = byRevenueCenter.get(revenueCenter) ?? { salesCents: 0, checkCount: 0, coverCount: 0 };
      revenueCenterRow.salesCents += check.totalCents;
      revenueCenterRow.checkCount += 1;
      revenueCenterRow.coverCount += check.guestCount ?? 1;
      byRevenueCenter.set(revenueCenter, revenueCenterRow);
    }

    return {
      summary: {
        ...acc,
        avgCheckCents: acc.checkCount ? Math.round(acc.salesCents / acc.checkCount) : 0,
        avgCheckTimeMins: timedChecks ? Math.round(totalTimeMins / timedChecks) : null,
      },
      byDay: Array.from(byDay.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, value]) => ({ date, ...value })),
      byTender: Array.from(byTender.entries())
        .map(([tenderType, value]) => ({ tenderType, ...value }))
        .sort((a, b) => b.salesCents - a.salesCents),
      byRevenueCenter: Array.from(byRevenueCenter.entries())
        .map(([revenueCenter, value]) => ({ revenueCenter, ...value }))
        .sort((a, b) => b.salesCents - a.salesCents),
    };
  },
});

// Per-day breakdown for sparklines: array of { date, salesCents, checkCount }
export const getSalesByDay = query({
  args: { venueId: v.id('venues'), windowDays: v.number() },
  returns: v.union(v.null(), v.array(v.object({ date: v.string(), salesCents: v.number(), checkCount: v.number(), coverCount: v.number() }))),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) return null;
    await requirePaidSubscription(ctx as AnyCtx, args.venueId);

    const window = Math.min(Math.max(1, Math.round(args.windowDays)), 90);
    const { start } = dayBounds(-window + 1);
    const end = dayBounds(1).start;

    const checks = await (ctx as AnyCtx).db
      .query('posChecks')
      .withIndex('by_venue_openedAt', (q: any) => q.eq('venueId', args.venueId).gte('openedAt', start).lt('openedAt', end))
      .order('asc')
      .take(5000);

    const byDay = new Map<string, { salesCents: number; checkCount: number; coverCount: number }>();
    for (const c of (checks as Doc<'posChecks'>[])) {
      if (c.status === 'void') continue;
      const date = isoDate(c.openedAt);
      const row = byDay.get(date) ?? { salesCents: 0, checkCount: 0, coverCount: 0 };
      row.salesCents += c.totalCents;
      row.checkCount += 1;
      row.coverCount += c.guestCount ?? 1;
      byDay.set(date, row);
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }));
  },
});

// Per-server breakdown: sales, tips, checks, covers.
export const getSalesByServer = query({
  args: { venueId: v.id('venues'), windowDays: v.number() },
  returns: v.union(v.null(), v.array(v.object({
    serverName: v.string(),
    salesCents: v.number(),
    tipCents: v.number(),
    discountCents: v.number(),
    compCents: v.number(),
    checkCount: v.number(),
    coverCount: v.number(),
    avgCheckCents: v.number(),
  }))),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) return null;
    await requirePaidSubscription(ctx as AnyCtx, args.venueId);

    const window = Math.min(Math.max(1, Math.round(args.windowDays)), 90);
    const { start } = dayBounds(-window + 1);
    const end = dayBounds(1).start;

    const checks = await (ctx as AnyCtx).db
      .query('posChecks')
      .withIndex('by_venue_openedAt', (q: any) => q.eq('venueId', args.venueId).gte('openedAt', start).lt('openedAt', end))
      .order('asc')
      .take(5000);

    type Row = { salesCents: number; tipCents: number; discountCents: number; compCents: number; checkCount: number; coverCount: number };
    const byServer = new Map<string, Row>();
    for (const c of (checks as Doc<'posChecks'>[])) {
      if (c.status === 'void') continue;
      const name = c.serverName?.trim() || 'Unknown';
      const row = byServer.get(name) ?? { salesCents: 0, tipCents: 0, discountCents: 0, compCents: 0, checkCount: 0, coverCount: 0 };
      row.salesCents += c.totalCents;
      row.tipCents += c.tipCents;
      row.discountCents += c.discountCents ?? 0;
      row.compCents += c.compCents ?? 0;
      row.checkCount += 1;
      row.coverCount += c.guestCount ?? 1;
      byServer.set(name, row);
    }
    return Array.from(byServer.entries())
      .map(([serverName, r]) => ({ serverName, ...r, avgCheckCents: r.checkCount ? Math.round(r.salesCents / r.checkCount) : 0 }))
      .sort((a, b) => b.salesCents - a.salesCents);
  },
});

// Per-revenue-center breakdown.
export const getSalesByRevenueCenter = query({
  args: { venueId: v.id('venues'), windowDays: v.number() },
  returns: v.union(v.null(), v.array(v.object({
    revenueCenter: v.string(),
    salesCents: v.number(),
    checkCount: v.number(),
    coverCount: v.number(),
  }))),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) return null;
    await requirePaidSubscription(ctx as AnyCtx, args.venueId);

    const window = Math.min(Math.max(1, Math.round(args.windowDays)), 90);
    const { start } = dayBounds(-window + 1);
    const end = dayBounds(1).start;

    const checks = await (ctx as AnyCtx).db
      .query('posChecks')
      .withIndex('by_venue_openedAt', (q: any) => q.eq('venueId', args.venueId).gte('openedAt', start).lt('openedAt', end))
      .order('asc')
      .take(5000);

    const byRC = new Map<string, { salesCents: number; checkCount: number; coverCount: number }>();
    for (const c of (checks as Doc<'posChecks'>[])) {
      if (c.status === 'void') continue;
      const rc = c.revenueCenter?.trim() || 'Default';
      const row = byRC.get(rc) ?? { salesCents: 0, checkCount: 0, coverCount: 0 };
      row.salesCents += c.totalCents;
      row.checkCount += 1;
      row.coverCount += c.guestCount ?? 1;
      byRC.set(rc, row);
    }
    return Array.from(byRC.entries())
      .map(([revenueCenter, r]) => ({ revenueCenter, ...r }))
      .sort((a, b) => b.salesCents - a.salesCents);
  },
});

// Per-tender-type breakdown.
export const getSalesByTender = query({
  args: { venueId: v.id('venues'), windowDays: v.number() },
  returns: v.union(v.null(), v.array(v.object({
    tenderType: v.string(),
    salesCents: v.number(),
    checkCount: v.number(),
  }))),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) return null;
    await requirePaidSubscription(ctx as AnyCtx, args.venueId);

    const window = Math.min(Math.max(1, Math.round(args.windowDays)), 90);
    const { start } = dayBounds(-window + 1);
    const end = dayBounds(1).start;

    const checks = await (ctx as AnyCtx).db
      .query('posChecks')
      .withIndex('by_venue_openedAt', (q: any) => q.eq('venueId', args.venueId).gte('openedAt', start).lt('openedAt', end))
      .order('asc')
      .take(5000);

    const byTender = new Map<string, { salesCents: number; checkCount: number }>();
    for (const c of (checks as Doc<'posChecks'>[])) {
      if (c.status === 'void') continue;
      const tender = c.tenderType?.trim() || 'Unknown';
      const row = byTender.get(tender) ?? { salesCents: 0, checkCount: 0 };
      row.salesCents += c.totalCents;
      row.checkCount += 1;
      byTender.set(tender, row);
    }
    return Array.from(byTender.entries())
      .map(([tenderType, r]) => ({ tenderType, ...r }))
      .sort((a, b) => b.salesCents - a.salesCents);
  },
});

// Top-selling menu items by revenue.
export const getTopMenuItems = query({
  args: { venueId: v.id('venues'), windowDays: v.number(), limit: v.optional(v.number()) },
  returns: v.union(v.null(), v.array(v.object({
    name: v.string(),
    category: v.union(v.string(), v.null()),
    quantity: v.number(),
    salesCents: v.number(),
  }))),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) return null;
    await requirePaidSubscription(ctx as AnyCtx, args.venueId);

    const window = Math.min(Math.max(1, Math.round(args.windowDays)), 90);
    const cap = Math.min(args.limit ?? 20, 50);
    const { start } = dayBounds(-window + 1);
    const end = dayBounds(1).start;

    const checks = await (ctx as AnyCtx).db
      .query('posChecks')
      .withIndex('by_venue_openedAt', (q: any) => q.eq('venueId', args.venueId).gte('openedAt', start).lt('openedAt', end))
      .order('asc')
      .take(5000);

    const byItem = new Map<string, { name: string; category: string | null; quantity: number; salesCents: number }>();
    for (const c of (checks as Doc<'posChecks'>[])) {
      if (c.status === 'void' || !c.menuItems) continue;
      for (const it of c.menuItems) {
        const key = it.name.toLowerCase();
        const row = byItem.get(key) ?? { name: it.name, category: it.category ?? null, quantity: 0, salesCents: 0 };
        row.quantity += it.quantity;
        row.salesCents += it.priceCents * it.quantity;
        byItem.set(key, row);
      }
    }
    return Array.from(byItem.values())
      .sort((a, b) => b.salesCents - a.salesCents)
      .slice(0, cap);
  },
});

// Labor summary from POS punches for a date window.
export const getLaborSummary = query({
  args: { venueId: v.id('venues'), windowDays: v.number() },
  returns: v.union(v.null(), v.object({
    totalRegularMins: v.number(),
    totalOvertimeMins: v.number(),
    totalPayCents: v.number(),
    totalTipsCents: v.number(),
    byEmployee: v.array(v.object({
      employeeName: v.string(),
      jobTitle: v.union(v.string(), v.null()),
      regularMins: v.number(),
      overtimeMins: v.number(),
      payCents: v.number(),
      tipsCents: v.number(),
    })),
  })),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) return null;
    await requirePaidSubscription(ctx as AnyCtx, args.venueId);

    const window = Math.min(Math.max(1, Math.round(args.windowDays)), 90);
    // Build the set of business dates we want.
    const dates: string[] = [];
    for (let i = -window + 1; i <= 0; i++) {
      dates.push(isoDate(dayBounds(i).start));
    }
    const dateSet = new Set(dates);

    const punches = await (ctx as AnyCtx).db
      .query('posLaborPunches')
      .withIndex('by_venue_date', (q: any) => q.eq('venueId', args.venueId).gte('businessDate', dates[0]).lte('businessDate', dates[dates.length - 1]))
      .order('asc')
      .take(2000);

    type EmpRow = { employeeName: string; jobTitle: string | null; regularMins: number; overtimeMins: number; payCents: number; tipsCents: number };
    const byEmp = new Map<string, EmpRow>();
    let totalRegularMins = 0, totalOvertimeMins = 0, totalPayCents = 0, totalTipsCents = 0;

    for (const p of (punches as Doc<'posLaborPunches'>[])) {
      if (!dateSet.has(p.businessDate)) continue;
      const row = byEmp.get(p.externalEmployeeId) ?? {
        employeeName: p.employeeName,
        jobTitle: p.jobTitle ?? null,
        regularMins: 0, overtimeMins: 0, payCents: 0, tipsCents: 0,
      };
      const reg = p.regularMinutes ?? 0;
      const ot = p.overtimeMinutes ?? 0;
      const pay = p.totalPayCents ?? 0;
      const tips = (p.tipsCents ?? 0) + (p.declaredTipsCents ?? 0);
      row.regularMins += reg;
      row.overtimeMins += ot;
      row.payCents += pay;
      row.tipsCents += tips;
      totalRegularMins += reg;
      totalOvertimeMins += ot;
      totalPayCents += pay;
      totalTipsCents += tips;
      byEmp.set(p.externalEmployeeId, row);
    }
    return {
      totalRegularMins,
      totalOvertimeMins,
      totalPayCents,
      totalTipsCents,
      byEmployee: Array.from(byEmp.values()).sort((a, b) => b.payCents - a.payCents),
    };
  },
});

// ---------- Mutations ----------

export const upsertPosConnection = mutation({
  args: {
    venueId: v.id('venues'),
    provider: posProviderValue,
    externalLocationId: v.optional(v.string()),
    status: posConnectionStatusValue,
  },
  returns: posConnectionWithSecretValue,
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) throw new Error('Not authorized');

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
      const freshSecret = existing.webhookSecret ? null : newWebhookSecret();
      await (ctx as AnyCtx).db.patch(existing._id, freshSecret ? { ...payload, webhookSecret: freshSecret } : payload);
      const updated = await (ctx as AnyCtx).db.get(existing._id);
      if (!updated) throw new Error('Unable to update POS connection');
      return { ...mapConnection(updated), webhookSecret: freshSecret };
    }
    const secret = newWebhookSecret();
    const id: Id<'posConnections'> = await (ctx as AnyCtx).db.insert('posConnections', { ...payload, webhookSecret: secret, createdAt: now });
    const created = await (ctx as AnyCtx).db.get(id);
    if (!created) throw new Error('Unable to create POS connection');
    return { ...mapConnection(created), webhookSecret: secret };
  },
});

export const rotatePosConnectionSecret = mutation({
  args: { connectionId: v.id('posConnections') },
  returns: v.object({ webhookSecret: v.string() }),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    const connection = await (ctx as AnyCtx).db.get(args.connectionId);
    if (!connection) throw new Error('Connection not found');
    if (!profile || profile.venueId !== connection.venueId || !canManage(profile.role)) throw new Error('Not authorized');
    await requirePaidSubscription(ctx as AnyCtx, connection.venueId);
    const secret = newWebhookSecret();
    await (ctx as AnyCtx).db.patch(connection._id, { webhookSecret: secret, updatedAt: Date.now() });
    return { webhookSecret: secret };
  },
});

export const importPosCheck = mutation({
  args: { venueId: v.id('venues'), provider: posProviderValue, check: posCheckInputValue },
  returns: posCheckValue,
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) throw new Error('Not authorized');

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
  args: {
    venueId: v.id('venues'),
    provider: posProviderValue,
    check: posCheckInputValue,
    connectionSecret: v.string(),
    externalLocationId: v.optional(v.string()),
  },
  returns: posCheckValue,
  handler: async (ctx, args) => {
    const connection = await (ctx as AnyCtx).db
      .query('posConnections')
      .withIndex('by_venue_and_provider', (q: any) => q.eq('venueId', args.venueId).eq('provider', args.provider))
      .unique();
    if (!connection) throw new Error('No POS connection configured for this venue/provider');
    if (!secretsMatch(connection.webhookSecret, args.connectionSecret)) throw new Error('Invalid connection secret');
    if (connection.externalLocationId && args.externalLocationId && connection.externalLocationId !== args.externalLocationId) {
      throw new Error('Location mismatch for this connection');
    }
    const check = await upsertCheck(ctx as AnyCtx, args);
    await (ctx as AnyCtx).db.patch(connection._id, { lastSyncAt: Date.now(), status: 'connected', updatedAt: Date.now() });
    return mapCheck(check);
  },
});

export const ingestLaborPunches = internalMutation({
  args: {
    venueId: v.id('venues'),
    provider: posProviderValue,
    punches: v.array(posLaborPunchInputValue),
    connectionSecret: v.string(),
  },
  returns: v.object({ upserted: v.number() }),
  handler: async (ctx, args) => {
    const connection = await (ctx as AnyCtx).db
      .query('posConnections')
      .withIndex('by_venue_and_provider', (q: any) => q.eq('venueId', args.venueId).eq('provider', args.provider))
      .unique();
    if (!connection) throw new Error('No POS connection configured for this venue/provider');
    if (!secretsMatch(connection.webhookSecret, args.connectionSecret)) throw new Error('Invalid connection secret');

    const now = Date.now();
    let upserted = 0;
    for (const p of args.punches) {
      const existing = await (ctx as AnyCtx).db
        .query('posLaborPunches')
        .withIndex('by_venue_employee', (q: any) => q.eq('venueId', args.venueId).eq('externalEmployeeId', p.externalEmployeeId))
        .filter((q: any) => q.eq(q.field('businessDate'), p.businessDate).eq(q.field('clockInAt'), p.clockInAt))
        .first();
      const payload = {
        venueId: args.venueId,
        provider: args.provider,
        externalEmployeeId: p.externalEmployeeId,
        employeeName: p.employeeName.trim().slice(0, 200),
        jobTitle: p.jobTitle ? p.jobTitle.trim().slice(0, 100) : undefined,
        clockInAt: p.clockInAt,
        clockOutAt: p.clockOutAt,
        regularMinutes: p.regularMinutes,
        overtimeMinutes: p.overtimeMinutes,
        declaredTipsCents: p.declaredTipsCents,
        tipsCents: p.tipsCents,
        regularPayCents: p.regularPayCents,
        overtimePayCents: p.overtimePayCents,
        totalPayCents: p.totalPayCents,
        businessDate: p.businessDate,
        updatedAt: now,
      };
      if (existing) {
        await (ctx as AnyCtx).db.patch(existing._id, payload);
      } else {
        await (ctx as AnyCtx).db.insert('posLaborPunches', payload);
      }
      upserted += 1;
    }
    return { upserted };
  },
});
