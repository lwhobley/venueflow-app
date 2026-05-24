import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { getAuthUserId } from '@convex-dev/auth/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireActiveSubscription } from './billing/shared';

type AnyCtx = any;

const goalPeriodValue = v.union(v.literal('day'), v.literal('week'));
const goalStatusValue = v.union(v.literal('open'), v.literal('done'), v.literal('cancelled'));

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

function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function mapGoal(goal: Doc<'managerGoals'>) {
  return {
    _id: goal._id,
    venueId: goal.venueId,
    title: goal.title,
    details: goal.details ?? null,
    period: goal.period,
    targetDate: goal.targetDate,
    status: goal.status,
    completedAt: goal.completedAt ?? null,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
  };
}

function mapEvent(event: Doc<'venueEvents'>, reservation: Doc<'reservations'> | null) {
  return {
    _id: event._id,
    venueId: event.venueId,
    title: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt ?? null,
    expectedGuests: event.expectedGuests ?? null,
    notes: event.notes ?? null,
    reservationId: event.reservationId ?? null,
    reservationNotes: reservation?.notes ?? reservation?.specialRequests ?? null,
    reservationGuestName: reservation?.guestName ?? null,
    reservationPartySize: reservation?.partySize ?? null,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

export const getManagerDashboard = query({
  args: { venueId: v.id('venues') },
  returns: v.union(
    v.null(),
    v.object({
      totalReservations: v.number(),
      todayReservations: v.number(),
      vipOrLargeReservations: v.array(
        v.object({
          _id: v.id('reservations'),
          guestName: v.string(),
          partySize: v.number(),
          reservationTime: v.number(),
          tags: v.array(v.string()),
          notes: v.union(v.string(), v.null()),
        }),
      ),
      goals: v.array(
        v.object({
          _id: v.id('managerGoals'),
          venueId: v.id('venues'),
          title: v.string(),
          details: v.union(v.string(), v.null()),
          period: goalPeriodValue,
          targetDate: v.string(),
          status: goalStatusValue,
          completedAt: v.union(v.number(), v.null()),
          createdAt: v.number(),
          updatedAt: v.number(),
        }),
      ),
      events: v.array(
        v.object({
          _id: v.id('venueEvents'),
          venueId: v.id('venues'),
          title: v.string(),
          startsAt: v.number(),
          endsAt: v.union(v.number(), v.null()),
          expectedGuests: v.union(v.number(), v.null()),
          notes: v.union(v.string(), v.null()),
          reservationId: v.union(v.id('reservations'), v.null()),
          reservationNotes: v.union(v.string(), v.null()),
          reservationGuestName: v.union(v.string(), v.null()),
          reservationPartySize: v.union(v.number(), v.null()),
          createdAt: v.number(),
          updatedAt: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) return null;
    await requireActiveSubscription(ctx as AnyCtx, args.venueId);
    const now = Date.now();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = todayStart.getTime() + 24 * 60 * 60 * 1000;
    const weekEnd = now + 7 * 24 * 60 * 60 * 1000;
    const reservations = await (ctx as AnyCtx).db.query('reservations').withIndex('by_venue_time', (q: any) => q.eq('venueId', args.venueId)).order('desc').take(500);
    const upcomingReservations = reservations.filter((reservation: Doc<'reservations'>) => reservation.reservationTime >= now && reservation.reservationTime <= weekEnd && reservation.status !== 'cancelled');
    const vipOrLargeReservations = upcomingReservations
      .filter((reservation: Doc<'reservations'>) => reservation.partySize >= 8 || reservation.tags.some((tag) => tag.toLowerCase().includes('vip')))
      .sort((a: Doc<'reservations'>, b: Doc<'reservations'>) => a.reservationTime - b.reservationTime)
      .slice(0, 8)
      .map((reservation: Doc<'reservations'>) => ({
        _id: reservation._id,
        guestName: reservation.guestName,
        partySize: reservation.partySize,
        reservationTime: reservation.reservationTime,
        tags: reservation.tags,
        notes: reservation.notes ?? reservation.specialRequests ?? null,
      }));
    const goals = await (ctx as AnyCtx).db.query('managerGoals').withIndex('by_venue_targetDate', (q: any) => q.eq('venueId', args.venueId)).order('desc').take(50);
    const events = await (ctx as AnyCtx).db.query('venueEvents').withIndex('by_venue_startsAt', (q: any) => q.eq('venueId', args.venueId)).order('asc').take(50);
    const eventRows = [];
    for (const event of events.filter((event: Doc<'venueEvents'>) => event.startsAt >= todayStart.getTime() && event.startsAt <= weekEnd).slice(0, 8)) {
      const reservation = event.reservationId ? await (ctx as AnyCtx).db.get(event.reservationId) : null;
      eventRows.push(mapEvent(event, reservation));
    }
    return {
      totalReservations: reservations.length,
      todayReservations: reservations.filter((reservation: Doc<'reservations'>) => reservation.reservationTime >= todayStart.getTime() && reservation.reservationTime < todayEnd).length,
      vipOrLargeReservations,
      goals: goals
        .filter((goal: Doc<'managerGoals'>) => goal.status === 'open' || goal.targetDate >= dateKey())
        .slice(0, 8)
        .map(mapGoal),
      events: eventRows,
    };
  },
});

export const upsertManagerGoal = mutation({
  args: {
    venueId: v.id('venues'),
    goalId: v.optional(v.id('managerGoals')),
    title: v.string(),
    details: v.optional(v.string()),
    period: goalPeriodValue,
    targetDate: v.string(),
    status: goalStatusValue,
  },
  returns: v.id('managerGoals'),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) throw new Error('Not authorized');
    assertNotDemo(profile);
    await requireActiveSubscription(ctx as AnyCtx, args.venueId);
    const now = Date.now();
    const payload = {
      venueId: args.venueId,
      title: args.title.trim(),
      details: cleanText(args.details),
      period: args.period,
      targetDate: args.targetDate,
      status: args.status,
      completedAt: args.status === 'done' ? now : undefined,
      updatedAt: now,
    };
    if (!payload.title) throw new Error('Goal title is required');
    if (args.goalId) {
      const existing = await (ctx as AnyCtx).db.get(args.goalId);
      if (!existing || existing.venueId !== args.venueId) throw new Error('Goal not found');
      await (ctx as AnyCtx).db.patch(existing._id, payload);
      return existing._id;
    }
    return await (ctx as AnyCtx).db.insert('managerGoals', { ...payload, createdBy: profile._id, createdAt: now });
  },
});

export const upsertVenueEvent = mutation({
  args: {
    venueId: v.id('venues'),
    eventId: v.optional(v.id('venueEvents')),
    title: v.string(),
    startsAt: v.number(),
    endsAt: v.optional(v.number()),
    expectedGuests: v.optional(v.number()),
    notes: v.optional(v.string()),
    reservationId: v.optional(v.id('reservations')),
  },
  returns: v.id('venueEvents'),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile.role)) throw new Error('Not authorized');
    assertNotDemo(profile);
    await requireActiveSubscription(ctx as AnyCtx, args.venueId);
    if (args.reservationId) {
      const reservation = await (ctx as AnyCtx).db.get(args.reservationId);
      if (!reservation || reservation.venueId !== args.venueId) throw new Error('Reservation not found');
    }
    const now = Date.now();
    const payload = {
      venueId: args.venueId,
      title: args.title.trim(),
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      expectedGuests: args.expectedGuests,
      notes: cleanText(args.notes),
      reservationId: args.reservationId,
      updatedAt: now,
    };
    if (!payload.title) throw new Error('Event title is required');
    if (args.eventId) {
      const existing = await (ctx as AnyCtx).db.get(args.eventId);
      if (!existing || existing.venueId !== args.venueId) throw new Error('Event not found');
      await (ctx as AnyCtx).db.patch(existing._id, payload);
      return existing._id;
    }
    return await (ctx as AnyCtx).db.insert('venueEvents', { ...payload, createdBy: profile._id, createdAt: now });
  },
});
