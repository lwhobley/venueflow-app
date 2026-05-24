import { mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { requireActiveSubscription } from './billing/shared';
import { getAuthUserId } from '@convex-dev/auth/server';

const roleValue = v.union(v.literal('admin'), v.literal('owner'), v.literal('manager'));
const reservationSourceValue = v.union(
  v.literal('direct'),
  v.literal('opentable'),
  v.literal('resy'),
  v.literal('phone'),
  v.literal('walk_in'),
  v.literal('sevenrooms'),
  v.literal('tock'),
  v.literal('google'),
);
const reservationStatusValue = v.union(
  v.literal('requested'),
  v.literal('confirmed'),
  v.literal('checked_in'),
  v.literal('seated'),
  v.literal('completed'),
  v.literal('no_show'),
  v.literal('cancelled'),
);

const reservationValue = v.object({
  _id: v.id('reservations'),
  _creationTime: v.number(),
  venueId: v.id('venues'),
  guestId: v.union(v.id('guests'), v.null()),
  guestName: v.string(),
  guestPhone: v.union(v.string(), v.null()),
  guestEmail: v.union(v.string(), v.null()),
  partySize: v.number(),
  reservationTime: v.number(),
  durationMinutes: v.number(),
  source: reservationSourceValue,
  status: reservationStatusValue,
  specialRequests: v.union(v.string(), v.null()),
  tags: v.array(v.string()),
  externalId: v.union(v.string(), v.null()),
  toastCheckGuid: v.union(v.string(), v.null()),
  depositStatus: v.union(v.string(), v.null()),
  depositAmount: v.union(v.number(), v.null()),
  checkInAt: v.union(v.number(), v.null()),
  seatedAt: v.union(v.number(), v.null()),
  completedAt: v.union(v.number(), v.null()),
  notes: v.union(v.string(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const reservationSettingsValue = v.object({
  _id: v.id('reservationSettings'),
  _creationTime: v.number(),
  venueId: v.id('venues'),
  defaultDiningMinutes: v.number(),
  defaultTurnMinutes: v.number(),
  bookingWindowDays: v.number(),
  minLeadHours: v.number(),
  updatedAt: v.number(),
});

function canManage(role: string) {
  return role === 'admin' || role === 'owner' || role === 'manager';
}

function assertNotDemo(profile: Doc<'profiles'> | null | undefined) {
  if (profile?.isDemo) throw new Error('Demo mode is read-only. Real changes are disabled for this profile.');
}

async function requireProfile(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error('Unauthenticated');
  const profile = await ctx.db.query('profiles').withIndex('by_userId', (q: any) => q.eq('userId', userId)).unique();
  if (!profile) throw new Error('Profile not found');
  return profile as Doc<'profiles'>;
}

async function loadSettings(ctx: any, venueId: string): Promise<Doc<'reservationSettings'> | null> {
  return await ctx.db.query('reservationSettings').withIndex('by_venue', (q: any) => q.eq('venueId', venueId)).unique();
}

function toReservationValue(reservation: Doc<'reservations'>) {
  return {
    _id: reservation._id,
    _creationTime: reservation._creationTime,
    venueId: reservation.venueId,
    guestId: reservation.guestId ?? null,
    guestName: reservation.guestName,
    guestPhone: reservation.guestPhone ?? null,
    guestEmail: reservation.guestEmail ?? null,
    partySize: reservation.partySize,
    reservationTime: reservation.reservationTime,
    durationMinutes: reservation.durationMinutes,
    source: reservation.source,
    status: reservation.status,
    specialRequests: reservation.specialRequests ?? null,
    tags: reservation.tags,
    externalId: reservation.externalId ?? null,
    toastCheckGuid: reservation.toastCheckGuid ?? null,
    depositStatus: reservation.depositStatus ?? null,
    depositAmount: reservation.depositAmount ?? null,
    checkInAt: reservation.checkInAt ?? null,
    seatedAt: reservation.seatedAt ?? null,
    completedAt: reservation.completedAt ?? null,
    notes: reservation.notes ?? null,
    createdAt: reservation.createdAt,
    updatedAt: reservation.updatedAt,
  };
}

function csvCell(value: string | number | null | undefined) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

async function listReservations(ctx: any, venueId: string) {
  const reservations = await ctx.db.query('reservations').withIndex('by_venue_time', (q: any) => q.eq('venueId', venueId)).collect();
  return reservations
    .sort((a: Doc<'reservations'>, b: Doc<'reservations'>) => b.reservationTime - a.reservationTime)
    .map((reservation: Doc<'reservations'>) => toReservationValue(reservation));
}

function normalizeText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function mergeTags(existing: string[], incoming: string[]) {
  return Array.from(new Set([...existing, ...incoming].map((tag) => tag.trim()).filter(Boolean))).slice(0, 12);
}

async function upsertReservationGuest(ctx: any, args: { venueId: Id<'venues'>; guestName: string; guestPhone?: string; guestEmail?: string; tags: string[]; notes?: string }) {
  const phone = normalizeText(args.guestPhone);
  const email = normalizeText(args.guestEmail)?.toLowerCase();
  let guest: Doc<'guests'> | null = null;
  if (email) {
    const matches = await ctx.db.query('guests').withIndex('by_email', (q: any) => q.eq('email', email)).take(10);
    guest = matches.find((item: Doc<'guests'>) => item.venueId === args.venueId) ?? null;
  }
  if (!guest && phone) {
    const matches = await ctx.db.query('guests').withIndex('by_phone', (q: any) => q.eq('phone', phone)).take(10);
    guest = matches.find((item: Doc<'guests'>) => item.venueId === args.venueId) ?? null;
  }
  if (!guest) {
    const guests = await ctx.db.query('guests').withIndex('by_venue', (q: any) => q.eq('venueId', args.venueId)).take(100);
    guest = guests.find((item: Doc<'guests'>) => item.fullName.toLowerCase() === args.guestName.trim().toLowerCase()) ?? null;
  }
  const now = Date.now();
  if (guest) {
    await ctx.db.patch(guest._id, {
      fullName: args.guestName.trim(),
      phone: phone ?? guest.phone,
      email: email ?? guest.email,
      tags: mergeTags(guest.tags, args.tags),
      notes: normalizeText(args.notes) ?? guest.notes,
      updatedAt: now,
    });
    return guest._id;
  }
  return await ctx.db.insert('guests', {
    venueId: args.venueId,
    fullName: args.guestName.trim(),
    phone,
    email,
    tags: mergeTags([], args.tags),
    notes: normalizeText(args.notes),
    createdAt: now,
    updatedAt: now,
  });
}

export const getReservationsPage = query({
  args: { venueId: v.id('venues') },
  returns: v.union(
    v.null(),
    v.object({
      settings: v.union(reservationSettingsValue, v.null()),
      reservations: v.array(reservationValue),
      activeCount: v.number(),
      upcomingCount: v.number(),
      cancelledCount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (profile.venueId !== args.venueId) return null;
    await requireActiveSubscription(ctx as any, args.venueId);
    const settings = await loadSettings(ctx, args.venueId);
    const reservations = await listReservations(ctx, args.venueId);
    const now = Date.now();
    const upcomingCutoff = now + (settings?.bookingWindowDays ?? 14) * 24 * 60 * 60 * 1000;
    return {
      settings: settings
        ? {
            _id: settings._id,
            _creationTime: settings._creationTime,
            venueId: settings.venueId,
            defaultDiningMinutes: settings.defaultDiningMinutes,
            defaultTurnMinutes: settings.defaultTurnMinutes,
            bookingWindowDays: settings.bookingWindowDays,
            minLeadHours: settings.minLeadHours,
            updatedAt: settings.updatedAt,
          }
        : null,
      reservations,
      activeCount: reservations.filter((item: { status: string }) => item.status === 'confirmed' || item.status === 'checked_in' || item.status === 'seated').length,
      upcomingCount: reservations.filter((item: { reservationTime: number; status: string }) => item.reservationTime >= now && item.reservationTime <= upcomingCutoff && item.status !== 'cancelled').length,
      cancelledCount: reservations.filter((item: { status: string }) => item.status === 'cancelled').length,
    };
  },
});

export const saveReservationSettings = mutation({
  args: {
    venueId: v.id('venues'),
    defaultDiningMinutes: v.number(),
    defaultTurnMinutes: v.number(),
    bookingWindowDays: v.number(),
    minLeadHours: v.number(),
  },
  returns: reservationSettingsValue,
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (!canManage(profile.role) || profile.venueId !== args.venueId) throw new Error('Not authorized');
    assertNotDemo(profile);
    await requireActiveSubscription(ctx as any, args.venueId);
    const existing = await loadSettings(ctx, args.venueId);
    const payload = {
      venueId: args.venueId,
      defaultDiningMinutes: args.defaultDiningMinutes,
      defaultTurnMinutes: args.defaultTurnMinutes,
      bookingWindowDays: args.bookingWindowDays,
      minLeadHours: args.minLeadHours,
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
      const updated = await ctx.db.get(existing._id);
      if (!updated) throw new Error('Unable to update reservation settings');
      return {
        _id: updated._id,
        _creationTime: updated._creationTime,
        venueId: updated.venueId,
        defaultDiningMinutes: updated.defaultDiningMinutes,
        defaultTurnMinutes: updated.defaultTurnMinutes,
        bookingWindowDays: updated.bookingWindowDays,
        minLeadHours: updated.minLeadHours,
        updatedAt: updated.updatedAt,
      };
    }
    const settingsId = await ctx.db.insert('reservationSettings', payload);
    const created = await ctx.db.get(settingsId);
    if (!created) throw new Error('Unable to create reservation settings');
    return {
      _id: created._id,
      _creationTime: created._creationTime,
      venueId: created.venueId,
      defaultDiningMinutes: created.defaultDiningMinutes,
      defaultTurnMinutes: created.defaultTurnMinutes,
      bookingWindowDays: created.bookingWindowDays,
      minLeadHours: created.minLeadHours,
      updatedAt: created.updatedAt,
    };
  },
});

export const saveReservation = mutation({
  args: {
    venueId: v.id('venues'),
    reservationId: v.optional(v.id('reservations')),
    guestName: v.string(),
    guestPhone: v.optional(v.string()),
    guestEmail: v.optional(v.string()),
    partySize: v.number(),
    reservationTime: v.number(),
    durationMinutes: v.number(),
    source: reservationSourceValue,
    status: reservationStatusValue,
    specialRequests: v.optional(v.string()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  returns: reservationValue,
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (!canManage(profile.role) || profile.venueId !== args.venueId) throw new Error('Not authorized');
    assertNotDemo(profile);
    await requireActiveSubscription(ctx as any, args.venueId);
    const now = Date.now();
    if (args.reservationId) {
      const existing = await ctx.db.get(args.reservationId);
      if (!existing) throw new Error('Reservation not found');
      if (existing.venueId !== args.venueId) throw new Error('Wrong venue');
      const guestId = await upsertReservationGuest(ctx, {
        venueId: args.venueId,
        guestName: args.guestName,
        guestPhone: args.guestPhone,
        guestEmail: args.guestEmail,
        tags: args.tags ?? [],
        notes: args.notes ?? args.specialRequests,
      });
      await ctx.db.patch(existing._id, {
        guestId,
        guestName: args.guestName,
        guestPhone: args.guestPhone,
        guestEmail: args.guestEmail,
        partySize: args.partySize,
        reservationTime: args.reservationTime,
        durationMinutes: args.durationMinutes,
        source: args.source,
        status: args.status,
        specialRequests: args.specialRequests,
        notes: args.notes,
        tags: args.tags ?? [],
        updatedAt: now,
      });
      await ctx.db.insert('notificationEvents', {
        venueId: args.venueId,
        audience: 'managers',
        kind: 'reservation_updated',
        title: 'Reservation updated',
        body: `${args.guestName} for ${args.partySize} on ${new Date(args.reservationTime).toLocaleString()}.`,
        readBy: [],
        createdAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.push.sendPushToAudience, {
        venueId: args.venueId,
        audience: 'managers',
        title: 'Reservation updated',
        body: `${args.guestName} for ${args.partySize}.`,
        data: { screen: 'reservations', reservationId: existing._id },
      });
      const updated = await ctx.db.get(existing._id);
      if (!updated) throw new Error('Unable to update reservation');
      return toReservationValue(updated);
    }
    const reservationId = await ctx.db.insert('reservations', {
      venueId: args.venueId,
      guestId: await upsertReservationGuest(ctx, {
        venueId: args.venueId,
        guestName: args.guestName,
        guestPhone: args.guestPhone,
        guestEmail: args.guestEmail,
        tags: args.tags ?? [],
        notes: args.notes ?? args.specialRequests,
      }),
      guestName: args.guestName,
      guestPhone: args.guestPhone,
      guestEmail: args.guestEmail,
      partySize: args.partySize,
      reservationTime: args.reservationTime,
      durationMinutes: args.durationMinutes,
      source: args.source,
      status: args.status,
      specialRequests: args.specialRequests,
      tags: args.tags ?? [],
      externalId: undefined,
      toastCheckGuid: undefined,
      depositStatus: undefined,
      depositAmount: undefined,
      checkInAt: undefined,
      seatedAt: undefined,
      completedAt: undefined,
      notes: args.notes,
      createdAt: now,
      updatedAt: now,
    });
    const created = await ctx.db.get(reservationId);
    if (!created) throw new Error('Unable to create reservation');
    await ctx.db.insert('notificationEvents', {
      venueId: args.venueId,
      audience: 'managers',
      kind: 'reservation_created',
      title: 'New reservation',
      body: `${args.guestName} for ${args.partySize} on ${new Date(args.reservationTime).toLocaleString()}.`,
      readBy: [],
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.push.sendPushToAudience, {
      venueId: args.venueId,
      audience: 'managers',
      title: 'New reservation',
      body: `${args.guestName} for ${args.partySize}.`,
      data: { screen: 'reservations', reservationId },
    });
    return toReservationValue(created);
  },
});

export const removeReservation = mutation({
  args: { venueId: v.id('venues'), reservationId: v.id('reservations') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (!canManage(profile.role) || profile.venueId !== args.venueId) throw new Error('Not authorized');
    assertNotDemo(profile);
    await requireActiveSubscription(ctx as any, args.venueId);
    const existing = await ctx.db.get(args.reservationId);
    if (!existing) return null;
    if (existing.venueId !== args.venueId) throw new Error('Wrong venue');
    const assignments = await ctx.db.query('tableAssignments').withIndex('by_reservation', (q: any) => q.eq('reservationId', existing._id)).collect();
    for (const assignment of assignments) await ctx.db.delete(assignment._id);

    const events = await ctx.db.query('venueEvents').withIndex('by_reservation', (q: any) => q.eq('reservationId', existing._id)).collect();
    for (const event of events) await ctx.db.patch(event._id, { reservationId: undefined, updatedAt: Date.now() });

    await ctx.db.delete(existing._id);
    return null;
  },
});

export const exportReservationsCsv = query({
  args: { venueId: v.id('venues') },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (!canManage(profile.role) || profile.venueId !== args.venueId) return null;
    const reservations = await ctx.db.query('reservations').withIndex('by_venue_time', (q: any) => q.eq('venueId', args.venueId)).collect();
    const rows = [['guestName', 'partySize', 'reservationTime', 'durationMinutes', 'source', 'status', 'phone', 'email', 'tags', 'notes']];
    for (const reservation of reservations.sort((a: Doc<'reservations'>, b: Doc<'reservations'>) => b.reservationTime - a.reservationTime).slice(0, 500)) {
      rows.push([
        reservation.guestName,
        String(reservation.partySize),
        new Date(reservation.reservationTime).toISOString(),
        String(reservation.durationMinutes),
        reservation.source,
        reservation.status,
        reservation.guestPhone ?? '',
        reservation.guestEmail ?? '',
        (reservation.tags ?? []).join('|'),
        reservation.notes ?? reservation.specialRequests ?? '',
      ]);
    }
    return rows.map((row) => row.map(csvCell).join(',')).join('\n');
  },
});
