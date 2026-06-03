import { internalMutation, mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { requirePaidSubscription } from './billing/shared';
import { timingSafeEqual, newWebhookSecret } from './secrets';
import { canManage, getProfileOrNull } from './authz';

type AnyCtx = any;

const providerValue = v.union(v.literal('opentable'), v.literal('resy'), v.literal('sevenrooms'), v.literal('tock'), v.literal('google'), v.literal('generic'));
const statusValue = v.union(v.literal('connected'), v.literal('paused'), v.literal('error'));
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

const externalReservationInput = v.object({
  externalId: v.string(),
  externalEventId: v.optional(v.string()),
  eventType: v.optional(v.string()),
  guestName: v.string(),
  guestPhone: v.optional(v.string()),
  guestEmail: v.optional(v.string()),
  partySize: v.number(),
  reservationTime: v.number(),
  durationMinutes: v.optional(v.number()),
  status: reservationStatusValue,
  source: v.optional(reservationSourceValue),
  specialRequests: v.optional(v.string()),
  notes: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  raw: v.optional(v.any()),
});

function cleanText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function mergeTags(existing: string[], incoming: string[]) {
  return Array.from(new Set([...existing, ...incoming].map((tag) => tag.trim()).filter(Boolean))).slice(0, 12);
}

async function upsertGuest(ctx: AnyCtx, args: { venueId: Id<'venues'>; guestName: string; guestPhone?: string; guestEmail?: string; tags: string[]; notes?: string }) {
  const phone = cleanText(args.guestPhone);
  const email = cleanText(args.guestEmail)?.toLowerCase();
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
      nameLower: args.guestName.trim().toLowerCase(),
      phone: phone ?? guest.phone,
      email: email ?? guest.email,
      tags: mergeTags(guest.tags, args.tags),
      notes: cleanText(args.notes) ?? guest.notes,
      updatedAt: now,
    });
    return guest._id;
  }
  return await ctx.db.insert('guests', {
    venueId: args.venueId,
    fullName: args.guestName.trim(),
    nameLower: args.guestName.trim().toLowerCase(),
    phone,
    email,
    tags: mergeTags([], args.tags),
    notes: cleanText(args.notes),
    createdAt: now,
    updatedAt: now,
  });
}

function mapConnection(connection: Doc<'reservationConnections'>) {
  return {
    _id: connection._id,
    venueId: connection.venueId,
    provider: connection.provider,
    externalVenueId: connection.externalVenueId ?? null,
    status: connection.status,
    lastSyncAt: connection.lastSyncAt ?? null,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

export const getReservationIntegrationOverview = query({
  args: { venueId: v.id('venues') },
  returns: v.union(
    v.null(),
    v.object({
      connections: v.array(
        v.object({
          _id: v.id('reservationConnections'),
          venueId: v.id('venues'),
          provider: providerValue,
          externalVenueId: v.union(v.string(), v.null()),
          status: statusValue,
          lastSyncAt: v.union(v.number(), v.null()),
          createdAt: v.number(),
          updatedAt: v.number(),
        }),
      ),
      recentEvents: v.array(
        v.object({
          _id: v.id('reservationSyncEvents'),
          provider: providerValue,
          externalEventId: v.string(),
          eventType: v.string(),
          processedAt: v.number(),
          status: v.string(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const profile = await getProfileOrNull(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile)) return null;
    await requirePaidSubscription(ctx as AnyCtx, args.venueId);
    const connections = await (ctx as AnyCtx).db.query('reservationConnections').withIndex('by_venue', (q: any) => q.eq('venueId', args.venueId)).take(20);
    const recentEvents = await (ctx as AnyCtx).db.query('reservationSyncEvents').withIndex('by_venue_processedAt', (q: any) => q.eq('venueId', args.venueId)).order('desc').take(20);
    return {
      connections: connections.map(mapConnection),
      recentEvents: recentEvents.map((event: Doc<'reservationSyncEvents'>) => ({
        _id: event._id,
        provider: event.provider,
        externalEventId: event.externalEventId,
        eventType: event.eventType,
        processedAt: event.processedAt,
        status: event.status,
      })),
    };
  },
});

export const upsertReservationConnection = mutation({
  args: { venueId: v.id('venues'), provider: providerValue, externalVenueId: v.optional(v.string()), status: statusValue },
  // webhookSecret is returned only when freshly generated (create or backfill);
  // null on a plain update. The stored secret is never readable again — use
  // rotateReservationConnectionSecret to obtain a new one.
  returns: v.object({
    _id: v.id('reservationConnections'),
    venueId: v.id('venues'),
    provider: providerValue,
    externalVenueId: v.union(v.string(), v.null()),
    status: statusValue,
    webhookSecret: v.union(v.string(), v.null()),
    lastSyncAt: v.union(v.number(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const profile = await getProfileOrNull(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile)) throw new Error('Not authorized');

    await requirePaidSubscription(ctx as AnyCtx, args.venueId);
    const now = Date.now();
    const existing = await (ctx as AnyCtx).db
      .query('reservationConnections')
      .withIndex('by_venue_and_provider', (q: any) => q.eq('venueId', args.venueId).eq('provider', args.provider))
      .unique();
    const payload = {
      venueId: args.venueId,
      provider: args.provider,
      externalVenueId: cleanText(args.externalVenueId),
      status: args.status,
      updatedAt: now,
    };
    if (existing) {
      const freshSecret = existing.webhookSecret ? null : newWebhookSecret();
      await (ctx as AnyCtx).db.patch(existing._id, freshSecret ? { ...payload, webhookSecret: freshSecret } : payload);
      const updated = await (ctx as AnyCtx).db.get(existing._id);
      if (!updated) throw new Error('Unable to update reservation connection');
      return { ...mapConnection(updated), webhookSecret: freshSecret };
    }
    const secret = newWebhookSecret();
    const id: Id<'reservationConnections'> = await (ctx as AnyCtx).db.insert('reservationConnections', { ...payload, webhookSecret: secret, createdAt: now });
    const created = await (ctx as AnyCtx).db.get(id);
    if (!created) throw new Error('Unable to create reservation connection');
    return { ...mapConnection(created), webhookSecret: secret };
  },
});

// Rotates the per-connection webhook secret and returns it once. The previous
// secret stops working immediately.
export const rotateReservationConnectionSecret = mutation({
  args: { connectionId: v.id('reservationConnections') },
  returns: v.object({ webhookSecret: v.string() }),
  handler: async (ctx, args) => {
    const profile = await getProfileOrNull(ctx as AnyCtx);
    const connection = await (ctx as AnyCtx).db.get(args.connectionId);
    if (!connection) throw new Error('Connection not found');
    if (!profile || profile.venueId !== connection.venueId || !canManage(profile)) throw new Error('Not authorized');
    await requirePaidSubscription(ctx as AnyCtx, connection.venueId);
    const secret = newWebhookSecret();
    await (ctx as AnyCtx).db.patch(connection._id, { webhookSecret: secret, updatedAt: Date.now() });
    return { webhookSecret: secret };
  },
});

export const ingestExternalReservation = internalMutation({
  args: {
    venueId: v.id('venues'),
    provider: providerValue,
    reservation: externalReservationInput,
    connectionSecret: v.string(),
    externalVenueId: v.optional(v.string()),
  },
  returns: v.object({ reservationId: v.id('reservations'), created: v.boolean() }),
  handler: async (ctx, args) => {
    // Only accept webhook writes for venues that have actually configured this
    // provider — limits a shared-secret holder to opted-in venues.
    const configuredConnection = await (ctx as AnyCtx).db
      .query('reservationConnections')
      .withIndex('by_venue_and_provider', (q: any) => q.eq('venueId', args.venueId).eq('provider', args.provider))
      .unique();
    if (!configuredConnection) throw new Error('No reservation connection configured for this venue/provider');
    // Per-connection secret: a leaked deployment-wide transport secret alone
    // can't post for a venue without also holding its connection secret.
    if (!timingSafeEqual(configuredConnection.webhookSecret, args.connectionSecret)) {
      throw new Error('Invalid connection secret');
    }
    // If the connection is bound to a specific external venue, the payload must
    // carry the matching id. A missing or different id is rejected — omitting it
    // must not be a way to bypass the binding.
    if (configuredConnection.externalVenueId && configuredConnection.externalVenueId !== args.externalVenueId) {
      throw new Error('Venue mismatch for this connection');
    }

    const eventId = args.reservation.externalEventId ?? `${args.provider}:${args.reservation.externalId}:${args.reservation.status}`;
    const duplicate = await (ctx as AnyCtx).db
      .query('reservationSyncEvents')
      .withIndex('by_venue_provider_external_id', (q: any) => q.eq('venueId', args.venueId).eq('provider', args.provider).eq('externalEventId', eventId))
      .unique();
    if (duplicate?.reservationId) return { reservationId: duplicate.reservationId, created: false };

    const now = Date.now();
    const tags = mergeTags([args.provider], args.reservation.tags ?? []);
    const guestId = await upsertGuest(ctx as AnyCtx, {
      venueId: args.venueId,
      guestName: args.reservation.guestName,
      guestPhone: args.reservation.guestPhone,
      guestEmail: args.reservation.guestEmail,
      tags,
      notes: args.reservation.notes ?? args.reservation.specialRequests,
    });
    const existing = await (ctx as AnyCtx).db
      .query('reservations')
      .withIndex('by_venue_external_id', (q: any) => q.eq('venueId', args.venueId).eq('externalId', args.reservation.externalId))
      .unique();
    const payload = {
      venueId: args.venueId,
      guestId,
      guestName: args.reservation.guestName.trim(),
      guestPhone: cleanText(args.reservation.guestPhone),
      guestEmail: cleanText(args.reservation.guestEmail)?.toLowerCase(),
      partySize: Math.max(1, Math.round(args.reservation.partySize)),
      reservationTime: args.reservation.reservationTime,
      durationMinutes: args.reservation.durationMinutes ?? 120,
      source: args.reservation.source ?? args.provider,
      status: args.reservation.status,
      specialRequests: cleanText(args.reservation.specialRequests),
      notes: cleanText(args.reservation.notes),
      tags,
      externalId: args.reservation.externalId,
      updatedAt: now,
    };
    let reservationId: Id<'reservations'>;
    let created = false;
    if (existing && existing.venueId === args.venueId) {
      await (ctx as AnyCtx).db.patch(existing._id, payload);
      reservationId = existing._id;
    } else {
      reservationId = await (ctx as AnyCtx).db.insert('reservations', {
        ...payload,
        toastCheckGuid: undefined,
        depositStatus: undefined,
        depositAmount: undefined,
        checkInAt: undefined,
        seatedAt: undefined,
        completedAt: undefined,
        createdAt: now,
      });
      created = true;
    }

    await (ctx as AnyCtx).db.insert('reservationSyncEvents', {
      venueId: args.venueId,
      provider: args.provider,
      externalEventId: eventId,
      eventType: args.reservation.eventType ?? (created ? 'created' : 'updated'),
      reservationId,
      payload: args.reservation.raw ?? args.reservation,
      processedAt: now,
      status: 'processed',
      errorMessage: undefined,
    });
    const connection = await (ctx as AnyCtx).db
      .query('reservationConnections')
      .withIndex('by_venue_and_provider', (q: any) => q.eq('venueId', args.venueId).eq('provider', args.provider))
      .unique();
    if (connection) await (ctx as AnyCtx).db.patch(connection._id, { lastSyncAt: now, status: 'connected', updatedAt: now });

    await (ctx as AnyCtx).db.insert('notificationEvents', {
      venueId: args.venueId,
      audience: 'managers',
      kind: created ? 'reservation_created' : 'reservation_updated',
      title: created ? 'New reservation synced' : 'Reservation updated',
      body: `${args.reservation.guestName} for ${args.reservation.partySize} via ${args.provider}.`,
      readBy: [],
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.push.sendPushToAudience, {
      venueId: args.venueId,
      audience: 'managers',
      title: created ? 'New reservation synced' : 'Reservation updated',
      body: `${args.reservation.guestName} for ${args.reservation.partySize} via ${args.provider}.`,
      data: { screen: 'reservations', reservationId },
    });
    return { reservationId, created };
  },
});
