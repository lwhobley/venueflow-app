import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { getAuthUserId } from '@convex-dev/auth/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireActiveSubscription } from './billing/shared';

type AnyCtx = any;

const payrollProviderValue = v.union(v.literal('gusto'), v.literal('adp'), v.literal('paychex'), v.literal('csv'));

const payrollRowValue = v.object({
  profileId: v.id('profiles'),
  employeeName: v.string(),
  email: v.string(),
  role: v.string(),
  jobTitle: v.string(),
  hours: v.number(),
  openEntryCount: v.number(),
  lastClockInAt: v.union(v.number(), v.null()),
  lastClockOutAt: v.union(v.number(), v.null()),
});

function canManage(role: string) {
  return role === 'admin' || role === 'owner' || role === 'manager';
}

async function getProfile(ctx: AnyCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return await ctx.db.query('profiles').withIndex('by_userId', (q: any) => q.eq('userId', userId)).unique();
}

function csvCell(value: string | number | null | undefined) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

async function buildPayrollRows(ctx: AnyCtx, venueId: Id<'venues'>, periodStart: number, periodEnd: number) {
  const staff = await ctx.db.query('profiles').withIndex('by_venueId', (q: any) => q.eq('venueId', venueId)).take(200);
  const entries = await ctx.db
    .query('timeEntries')
    .withIndex('by_venue_clockInAt', (q: any) => q.eq('venueId', venueId).lte('clockInAt', periodEnd))
    .order('desc')
    .take(1000);
  return staff
    .map((member: Doc<'profiles'>) => {
      const memberEntries = entries.filter((entry: Doc<'timeEntries'>) => {
        const end = entry.clockOutAt ?? Date.now();
        return entry.profileId === member._id && end >= periodStart && entry.clockInAt <= periodEnd;
      });
      const hours = memberEntries.reduce((sum: number, entry: Doc<'timeEntries'>) => {
        if (!entry.clockOutAt) return sum;
        const start = Math.max(entry.clockInAt, periodStart);
        const end = Math.min(entry.clockOutAt, periodEnd);
        return sum + Math.max(0, end - start) / 3600000;
      }, 0);
      const lastEntry = memberEntries.sort((a: Doc<'timeEntries'>, b: Doc<'timeEntries'>) => b.clockInAt - a.clockInAt)[0];
      return {
        profileId: member._id,
        employeeName: member.fullName,
        email: member.email,
        role: member.role,
        jobTitle: member.jobTitle,
        hours: Math.round(hours * 100) / 100,
        openEntryCount: memberEntries.filter((entry: Doc<'timeEntries'>) => entry.isOpen).length,
        lastClockInAt: lastEntry?.clockInAt ?? null,
        lastClockOutAt: lastEntry?.clockOutAt ?? null,
      };
    })
    .sort((a: { employeeName: string }, b: { employeeName: string }) => a.employeeName.localeCompare(b.employeeName));
}

export const getPayrollSummary = query({
  args: {
    venueId: v.id('venues'),
    periodStart: v.optional(v.number()),
    periodEnd: v.optional(v.number()),
  },
  returns: v.union(
    v.null(),
    v.object({
      periodStart: v.number(),
      periodEnd: v.number(),
      totalHours: v.number(),
      openEntryCount: v.number(),
      rows: v.array(payrollRowValue),
      lastExportAt: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) return null;
    await requireActiveSubscription(ctx as AnyCtx, args.venueId);
    const now = Date.now();
    const periodEnd = args.periodEnd ?? now;
    const periodStart = args.periodStart ?? now - 14 * 24 * 60 * 60 * 1000;
    const rows = await buildPayrollRows(ctx as AnyCtx, args.venueId, periodStart, periodEnd);
    const exports = await (ctx as AnyCtx).db.query('payrollExports').withIndex('by_venue_createdAt', (q: any) => q.eq('venueId', args.venueId)).order('desc').take(1);
    return {
      periodStart,
      periodEnd,
      totalHours: Math.round(rows.reduce((sum: number, row: { hours: number }) => sum + row.hours, 0) * 100) / 100,
      openEntryCount: rows.reduce((sum: number, row: { openEntryCount: number }) => sum + row.openEntryCount, 0),
      rows,
      lastExportAt: exports[0]?.createdAt ?? null,
    };
  },
});

export const exportPayrollCsv = query({
  args: {
    venueId: v.id('venues'),
    periodStart: v.optional(v.number()),
    periodEnd: v.optional(v.number()),
  },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) return null;
    await requireActiveSubscription(ctx as AnyCtx, args.venueId);
    const now = Date.now();
    const periodEnd = args.periodEnd ?? now;
    const periodStart = args.periodStart ?? now - 14 * 24 * 60 * 60 * 1000;
    const rows = await buildPayrollRows(ctx as AnyCtx, args.venueId, periodStart, periodEnd);
    const csvRows = [['employeeName', 'email', 'role', 'jobTitle', 'periodStart', 'periodEnd', 'hours', 'openEntryCount', 'lastClockInAt', 'lastClockOutAt']];
    for (const row of rows) {
      csvRows.push([
        row.employeeName,
        row.email,
        row.role,
        row.jobTitle,
        new Date(periodStart).toISOString(),
        new Date(periodEnd).toISOString(),
        String(row.hours),
        String(row.openEntryCount),
        row.lastClockInAt ? new Date(row.lastClockInAt).toISOString() : '',
        row.lastClockOutAt ? new Date(row.lastClockOutAt).toISOString() : '',
      ]);
    }
    return csvRows.map((row) => row.map(csvCell).join(',')).join('\n');
  },
});

export const recordPayrollExport = mutation({
  args: {
    venueId: v.id('venues'),
    provider: payrollProviderValue,
    periodStart: v.number(),
    periodEnd: v.number(),
  },
  returns: v.object({ exportId: v.id('payrollExports'), rowCount: v.number(), totalHours: v.number() }),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) throw new Error('Not authorized');

    await requireActiveSubscription(ctx as AnyCtx, args.venueId);
    const rows = await buildPayrollRows(ctx as AnyCtx, args.venueId, args.periodStart, args.periodEnd);
    const totalHours = Math.round(rows.reduce((sum: number, row: { hours: number }) => sum + row.hours, 0) * 100) / 100;
    const exportId = await (ctx as AnyCtx).db.insert('payrollExports', {
      venueId: args.venueId,
      provider: args.provider,
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      rowCount: rows.length,
      totalHours,
      createdBy: profile._id,
      createdAt: Date.now(),
    });
    return { exportId, rowCount: rows.length, totalHours };
  },
});
