import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { getAuthUserId } from '@convex-dev/auth/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireActiveSubscription } from './billing/shared';

type AnyCtx = any;

const roleValue = v.union(v.literal('admin'), v.literal('owner'), v.literal('manager'), v.literal('server'), v.literal('staff'));

const guestSummaryValue = v.object({
  _id: v.id('guests'),
  venueId: v.id('venues'),
  fullName: v.string(),
  phone: v.union(v.string(), v.null()),
  email: v.union(v.string(), v.null()),
  tags: v.array(v.string()),
  notes: v.union(v.string(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
  reservationCount: v.number(),
  visitCount: v.number(),
  lastVisitAt: v.union(v.number(), v.null()),
  upcomingReservationAt: v.union(v.number(), v.null()),
  totalSpendCents: v.number(),
});

const guestProfileValue = v.object({
  guest: guestSummaryValue,
  reservations: v.array(
    v.object({
      _id: v.id('reservations'),
      guestName: v.string(),
      partySize: v.number(),
      reservationTime: v.number(),
      status: v.string(),
      tags: v.array(v.string()),
      notes: v.union(v.string(), v.null()),
    }),
  ),
  checks: v.array(
    v.object({
      _id: v.id('posChecks'),
      provider: v.string(),
      externalCheckId: v.string(),
      openedAt: v.number(),
      closedAt: v.union(v.number(), v.null()),
      totalCents: v.number(),
      tipCents: v.number(),
      status: v.string(),
    }),
  ),
});

async function getProfile(ctx: AnyCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return await ctx.db.query('profiles').withIndex('by_userId', (q: any) => q.eq('userId', userId)).unique();
}

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

function cleanTags(tags: string[]) {
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))).slice(0, 12);
}

async function summarizeGuest(ctx: AnyCtx, guest: Doc<'guests'>) {
  const reservationRows = await ctx.db.query('reservations').withIndex('by_guest', (q: any) => q.eq('guestId', guest._id)).take(50);
  const reservations = reservationRows.filter((reservation: Doc<'reservations'>) => !reservation.deletedAt);
  const checks = await ctx.db.query('posChecks').withIndex('by_guest', (q: any) => q.eq('guestId', guest._id)).take(50);
  const now = Date.now();
  const completedReservations = reservations.filter((reservation: Doc<'reservations'>) => reservation.status === 'completed' || reservation.status === 'seated');
  const paidChecks = checks.filter((check: Doc<'posChecks'>) => check.status === 'paid');
  const upcoming = reservations
    .filter((reservation: Doc<'reservations'>) => reservation.reservationTime >= now && reservation.status !== 'cancelled')
    .sort((a: Doc<'reservations'>, b: Doc<'reservations'>) => a.reservationTime - b.reservationTime)[0];
  const lastVisitAt = Math.max(
    0,
    ...completedReservations.map((reservation: Doc<'reservations'>) => reservation.completedAt ?? reservation.reservationTime),
    ...paidChecks.map((check: Doc<'posChecks'>) => check.closedAt ?? check.openedAt),
  );
  return {
    _id: guest._id,
    venueId: guest.venueId,
    fullName: guest.fullName,
    phone: guest.phone ?? null,
    email: guest.email ?? null,
    tags: guest.tags,
    notes: guest.notes ?? null,
    createdAt: guest.createdAt,
    updatedAt: guest.updatedAt,
    reservationCount: reservations.length,
    visitCount: completedReservations.length + paidChecks.length,
    lastVisitAt: lastVisitAt > 0 ? lastVisitAt : null,
    upcomingReservationAt: upcoming?.reservationTime ?? null,
    totalSpendCents: paidChecks.reduce((sum: number, check: Doc<'posChecks'>) => sum + check.totalCents, 0),
  };
}

export const listGuests = query({
  args: { venueId: v.id('venues') },
  returns: v.array(guestSummaryValue),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) return [];
    await requireActiveSubscription(ctx as AnyCtx, args.venueId);
    const guests = await (ctx as AnyCtx).db.query('guests').withIndex('by_venue', (q: any) => q.eq('venueId', args.venueId)).order('desc').take(100);
    const summaries = [];
    for (const guest of guests.filter((row: Doc<'guests'>) => !row.deletedAt)) summaries.push(await summarizeGuest(ctx as AnyCtx, guest));
    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const getGuestProfile = query({
  args: { venueId: v.id('venues'), guestId: v.id('guests') },
  returns: v.union(v.null(), guestProfileValue),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) return null;
    await requireActiveSubscription(ctx as AnyCtx, args.venueId);
    const guest = await (ctx as AnyCtx).db.get(args.guestId);
    if (!guest || guest.venueId !== args.venueId || guest.deletedAt) return null;
    const reservationRows = await (ctx as AnyCtx).db.query('reservations').withIndex('by_guest', (q: any) => q.eq('guestId', args.guestId)).order('desc').take(25);
    const reservations = reservationRows.filter((reservation: Doc<'reservations'>) => !reservation.deletedAt);
    const checks = await (ctx as AnyCtx).db.query('posChecks').withIndex('by_guest', (q: any) => q.eq('guestId', args.guestId)).order('desc').take(25);
    return {
      guest: await summarizeGuest(ctx as AnyCtx, guest),
      reservations: reservations.map((reservation: Doc<'reservations'>) => ({
        _id: reservation._id,
        guestName: reservation.guestName,
        partySize: reservation.partySize,
        reservationTime: reservation.reservationTime,
        status: reservation.status,
        tags: reservation.tags,
        notes: reservation.notes ?? reservation.specialRequests ?? null,
      })),
      checks: checks.map((check: Doc<'posChecks'>) => ({
        _id: check._id,
        provider: check.provider,
        externalCheckId: check.externalCheckId,
        openedAt: check.openedAt,
        closedAt: check.closedAt ?? null,
        totalCents: check.totalCents,
        tipCents: check.tipCents,
        status: check.status,
      })),
    };
  },
});

export const upsertGuest = mutation({
  args: {
    venueId: v.id('venues'),
    guestId: v.optional(v.id('guests')),
    fullName: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  returns: guestSummaryValue,
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) throw new Error('Not authorized');
    assertNotDemo(profile);
    await requireActiveSubscription(ctx as AnyCtx, args.venueId);
    const fullName = args.fullName.trim();
    if (!fullName) throw new Error('Guest name is required');
    const now = Date.now();
    const payload = {
      venueId: args.venueId,
      fullName,
      phone: cleanText(args.phone),
      email: cleanText(args.email)?.toLowerCase(),
      tags: cleanTags(args.tags ?? []),
      notes: cleanText(args.notes),
      updatedAt: now,
    };

    if (args.guestId) {
      const existing = await (ctx as AnyCtx).db.get(args.guestId);
      if (!existing || existing.venueId !== args.venueId) throw new Error('Guest not found');
      await (ctx as AnyCtx).db.patch(existing._id, payload);
      const updated = await (ctx as AnyCtx).db.get(existing._id);
      if (!updated) throw new Error('Unable to update guest');
      return await summarizeGuest(ctx as AnyCtx, updated);
    }

    const guestId: Id<'guests'> = await (ctx as AnyCtx).db.insert('guests', { ...payload, createdAt: now });
    const created = await (ctx as AnyCtx).db.get(guestId);
    if (!created) throw new Error('Unable to create guest');
    return await summarizeGuest(ctx as AnyCtx, created);
  },
});

export const removeGuest = mutation({
  args: { venueId: v.id('venues'), guestId: v.id('guests') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) throw new Error('Not authorized');
    assertNotDemo(profile);
    await requireActiveSubscription(ctx as AnyCtx, args.venueId);

    const guest = await (ctx as AnyCtx).db.get(args.guestId);
    if (!guest) return null;
    if (guest.venueId !== args.venueId) throw new Error('Guest not found');
    const now = Date.now();
    await (ctx as AnyCtx).db.patch(guest._id, { deletedAt: now, updatedAt: now });
    return null;
  },
});
