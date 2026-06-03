import { internalMutation, mutation, query } from './_generated/server';
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { requirePaidSubscription } from './billing/shared';
import { timingSafeEqual, newWebhookSecret } from './secrets';
import { canManage, getProfileOrNull } from './authz';

type AnyCtx = any;

const roleValue = v.union(v.literal('admin'), v.literal('owner'), v.literal('manager'), v.literal('server'), v.literal('staff'));

const guestSummaryValue = v.object({
  _id: v.id('guests'),
  venueId: v.id('venues'),
  fullName: v.string(),
  phone: v.union(v.string(), v.null()),
  email: v.union(v.string(), v.null()),
  lifecycleStage: v.union(v.literal('lead'), v.literal('regular'), v.literal('vip'), v.literal('lapsed')),
  source: v.union(v.string(), v.null()),
  birthday: v.union(v.string(), v.null()),
  company: v.union(v.string(), v.null()),
  marketingOptIn: v.boolean(),
  favoriteTable: v.union(v.string(), v.null()),
  preferredServer: v.union(v.string(), v.null()),
  dietaryNotes: v.union(v.string(), v.null()),
  tags: v.array(v.string()),
  notes: v.union(v.string(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
  reservationCount: v.number(),
  visitCount: v.number(),
  lastVisitAt: v.union(v.number(), v.null()),
  upcomingReservationAt: v.union(v.number(), v.null()),
  totalSpendCents: v.number(),
  averageSpendCents: v.number(),
  daysSinceLastVisit: v.union(v.number(), v.null()),
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
      isPrivateEvent: v.boolean(),
      eventName: v.union(v.string(), v.null()),
      eventStatus: v.union(v.string(), v.null()),
      eventSpace: v.union(v.string(), v.null()),
      setupStyle: v.union(v.string(), v.null()),
      menuNotes: v.union(v.string(), v.null()),
      beverageNotes: v.union(v.string(), v.null()),
      billingNotes: v.union(v.string(), v.null()),
      estimatedValueCents: v.union(v.number(), v.null()),
      depositDueCents: v.union(v.number(), v.null()),
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
      revenueCenter: v.union(v.string(), v.null()),
      tenderType: v.union(v.string(), v.null()),
      guestCount: v.union(v.number(), v.null()),
      menuItems: v.array(v.object({ name: v.string(), category: v.union(v.string(), v.null()), quantity: v.number(), priceCents: v.number() })),
    }),
  ),
});

const lifecycleStageValue = v.union(v.literal('lead'), v.literal('regular'), v.literal('vip'), v.literal('lapsed'));
const leadInputValue = v.object({
  fullName: v.string(),
  phone: v.optional(v.string()),
  email: v.optional(v.string()),
  source: v.optional(v.string()),
  company: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  notes: v.optional(v.string()),
  marketingOptIn: v.optional(v.boolean()),
});

const leadIngestResultValue = v.object({
  created: v.number(),
  updated: v.number(),
  skipped: v.number(),
  guestIds: v.array(v.id('guests')),
});

function cleanText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function cleanTags(tags: string[]) {
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))).slice(0, 12);
}

function mergeTags(existing: string[], incoming: string[]) {
  return cleanTags([...existing, ...incoming]);
}

async function findExistingGuest(ctx: AnyCtx, args: { venueId: Id<'venues'>; email?: string; phone?: string; fullName: string }) {
  if (args.email) {
    const matches = await ctx.db.query('guests').withIndex('by_email', (q: any) => q.eq('email', args.email)).take(10);
    const match = matches.find((guest: Doc<'guests'>) => guest.venueId === args.venueId && !guest.deletedAt);
    if (match) return match;
  }
  if (args.phone) {
    const matches = await ctx.db.query('guests').withIndex('by_phone', (q: any) => q.eq('phone', args.phone)).take(10);
    const match = matches.find((guest: Doc<'guests'>) => guest.venueId === args.venueId && !guest.deletedAt);
    if (match) return match;
  }
  const candidates = await ctx.db.query('guests').withIndex('by_venue', (q: any) => q.eq('venueId', args.venueId)).take(300);
  const nameKey = args.fullName.trim().toLowerCase();
  return candidates.find((guest: Doc<'guests'>) => !guest.deletedAt && guest.fullName.trim().toLowerCase() === nameKey) ?? null;
}

async function ingestLeadRows(ctx: AnyCtx, venueId: Id<'venues'>, leads: Array<{ fullName: string; phone?: string; email?: string; source?: string; company?: string; tags?: string[]; notes?: string; marketingOptIn?: boolean }>) {
  const now = Date.now();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const guestIds: Id<'guests'>[] = [];
  const seen = new Set<string>();

  for (const lead of leads.slice(0, 100)) {
    const fullName = lead.fullName.trim();
    if (!fullName) {
      skipped += 1;
      continue;
    }
    const phone = cleanText(lead.phone);
    const email = cleanText(lead.email)?.toLowerCase();
    const key = email ?? phone ?? fullName.toLowerCase();
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);

    const existing = await findExistingGuest(ctx, { venueId, email, phone, fullName });
    const incomingTags = cleanTags([...(lead.tags ?? []), 'lead']);
    const source = cleanText(lead.source);
    const notes = cleanText(lead.notes);
    const company = cleanText(lead.company);

    if (existing) {
      await ctx.db.patch(existing._id, {
        fullName,
        nameLower: fullName.trim().toLowerCase(),
        phone: phone ?? existing.phone,
        email: email ?? existing.email,
        lifecycleStage: existing.lifecycleStage ?? 'lead',
        source: source ?? existing.source,
        company: company ?? existing.company,
        marketingOptIn: lead.marketingOptIn ?? existing.marketingOptIn ?? false,
        tags: mergeTags(existing.tags, incomingTags),
        notes: notes ? [existing.notes, notes].filter(Boolean).join('\n') : existing.notes,
        updatedAt: now,
      });
      guestIds.push(existing._id);
      updated += 1;
    } else {
      const guestId: Id<'guests'> = await ctx.db.insert('guests', {
        venueId,
        fullName,
        nameLower: fullName.trim().toLowerCase(),
        phone,
        email,
        lifecycleStage: 'lead',
        source,
        company,
        marketingOptIn: lead.marketingOptIn ?? false,
        tags: incomingTags,
        notes,
        createdAt: now,
        updatedAt: now,
      });
      guestIds.push(guestId);
      created += 1;
    }
  }

  return { created, updated, skipped, guestIds };
}

async function summarizeGuest(ctx: AnyCtx, guest: Doc<'guests'>) {
  const reservationRows = await ctx.db.query('reservations').withIndex('by_guest', (q: any) => q.eq('guestId', guest._id)).take(50);
  const reservations = reservationRows.filter((reservation: Doc<'reservations'>) => !reservation.deletedAt);
  const checks = await ctx.db.query('posChecks').withIndex('by_guest', (q: any) => q.eq('guestId', guest._id)).take(50);
  const now = Date.now();
  const completedReservations = reservations.filter((reservation: Doc<'reservations'>) => reservation.status === 'completed' || reservation.status === 'seated');
  const paidChecks = checks.filter((check: Doc<'posChecks'>) => check.status === 'paid');
  const totalSpendCents = paidChecks.reduce((sum: number, check: Doc<'posChecks'>) => sum + check.totalCents, 0);
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
    lifecycleStage: guest.lifecycleStage ?? (totalSpendCents >= 100000 || paidChecks.length >= 5 ? 'vip' : paidChecks.length >= 2 || completedReservations.length >= 2 ? 'regular' : 'lead'),
    source: guest.source ?? null,
    birthday: guest.birthday ?? null,
    company: guest.company ?? null,
    marketingOptIn: guest.marketingOptIn ?? false,
    favoriteTable: guest.favoriteTable ?? null,
    preferredServer: guest.preferredServer ?? null,
    dietaryNotes: guest.dietaryNotes ?? null,
    tags: guest.tags,
    notes: guest.notes ?? null,
    createdAt: guest.createdAt,
    updatedAt: guest.updatedAt,
    reservationCount: reservations.length,
    visitCount: completedReservations.length + paidChecks.length,
    lastVisitAt: lastVisitAt > 0 ? lastVisitAt : null,
    upcomingReservationAt: upcoming?.reservationTime ?? null,
    totalSpendCents,
    averageSpendCents: paidChecks.length ? Math.round(totalSpendCents / paidChecks.length) : 0,
    daysSinceLastVisit: lastVisitAt > 0 ? Math.floor((now - lastVisitAt) / (24 * 60 * 60 * 1000)) : null,
  };
}

export const listGuests = query({
  args: { venueId: v.id('venues') },
  returns: v.array(guestSummaryValue),
  handler: async (ctx, args) => {
    const profile = await getProfileOrNull(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile)) return [];
    await requirePaidSubscription(ctx as AnyCtx, args.venueId);
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
    const profile = await getProfileOrNull(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile)) return null;
    await requirePaidSubscription(ctx as AnyCtx, args.venueId);
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
        isPrivateEvent: reservation.isPrivateEvent ?? false,
        eventName: reservation.eventName ?? null,
        eventStatus: reservation.eventStatus ?? null,
        eventSpace: reservation.eventSpace ?? null,
        setupStyle: reservation.setupStyle ?? null,
        menuNotes: reservation.menuNotes ?? null,
        beverageNotes: reservation.beverageNotes ?? null,
        billingNotes: reservation.billingNotes ?? null,
        estimatedValueCents: reservation.estimatedValueCents ?? null,
        depositDueCents: reservation.depositDueCents ?? null,
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
        revenueCenter: check.revenueCenter ?? null,
        tenderType: check.tenderType ?? null,
        guestCount: check.guestCount ?? null,
        menuItems: (check.menuItems ?? []).slice(0, 12).map((item) => ({
          name: item.name,
          category: item.category ?? null,
          quantity: item.quantity,
          priceCents: item.priceCents,
        })),
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
    lifecycleStage: v.optional(lifecycleStageValue),
    source: v.optional(v.string()),
    birthday: v.optional(v.string()),
    company: v.optional(v.string()),
    marketingOptIn: v.optional(v.boolean()),
    favoriteTable: v.optional(v.string()),
    preferredServer: v.optional(v.string()),
    dietaryNotes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  returns: guestSummaryValue,
  handler: async (ctx, args) => {
    const profile = await getProfileOrNull(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile)) throw new Error('Not authorized');

    await requirePaidSubscription(ctx as AnyCtx, args.venueId);
    const fullName = args.fullName.trim();
    if (!fullName) throw new Error('Guest name is required');
    const now = Date.now();
    const payload = {
      venueId: args.venueId,
      fullName,
      nameLower: fullName.trim().toLowerCase(),
      phone: cleanText(args.phone),
      email: cleanText(args.email)?.toLowerCase(),
      lifecycleStage: args.lifecycleStage,
      source: cleanText(args.source),
      birthday: cleanText(args.birthday),
      company: cleanText(args.company),
      marketingOptIn: args.marketingOptIn ?? false,
      favoriteTable: cleanText(args.favoriteTable),
      preferredServer: cleanText(args.preferredServer),
      dietaryNotes: cleanText(args.dietaryNotes),
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

export const ingestLeads = mutation({
  args: { venueId: v.id('venues'), leads: v.array(leadInputValue) },
  returns: leadIngestResultValue,
  handler: async (ctx, args) => {
    const profile = await getProfileOrNull(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile)) throw new Error('Not authorized');

    await requirePaidSubscription(ctx as AnyCtx, args.venueId);
    return await ingestLeadRows(ctx as AnyCtx, args.venueId, args.leads);
  },
});

export const ingestLeadsFromWebhook = internalMutation({
  args: { venueId: v.id('venues'), leads: v.array(leadInputValue), connectionSecret: v.string() },
  returns: leadIngestResultValue,
  handler: async (ctx, args) => {
    const venue = await (ctx as AnyCtx).db.get(args.venueId);
    if (!venue || venue.deletedAt) throw new Error('Venue not found');
    // Per-venue secret: a leaked deployment-wide LEADS_WEBHOOK_SECRET alone can't
    // inject leads into a venue without also holding that venue's connection
    // secret. The venue owner generates it from the Integrations screen.
    if (!venue.leadsWebhookSecret) throw new Error('Lead ingestion is not enabled for this venue');
    if (!timingSafeEqual(venue.leadsWebhookSecret, args.connectionSecret)) throw new Error('Invalid connection secret');
    // CRM (lead capture and the guest list) is a paid feature: rotateLeadsWebhookSecret
    // and listGuests both require an active subscription, so ingest must match —
    // otherwise a trial venue could never hold a secret to reach this point.
    if (venue.subscriptionStatus !== 'active') throw new Error('Subscription required');
    return await ingestLeadRows(ctx as AnyCtx, args.venueId, args.leads);
  },
});

// Generates (or rotates) the per-venue secret for the /crm/leads webhook. The
// secret is returned once and never exposed through reads. Manager-only.
export const rotateLeadsWebhookSecret = mutation({
  args: { venueId: v.id('venues') },
  returns: v.object({ webhookSecret: v.string() }),
  handler: async (ctx, args) => {
    const profile = await getProfileOrNull(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile)) throw new Error('Not authorized');
    await requirePaidSubscription(ctx as AnyCtx, args.venueId);
    const secret = newWebhookSecret();
    await (ctx as AnyCtx).db.patch(args.venueId, { leadsWebhookSecret: secret });
    return { webhookSecret: secret };
  },
});

export const removeGuest = mutation({
  args: { venueId: v.id('venues'), guestId: v.id('guests') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const profile = await getProfileOrNull(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !canManage(profile)) throw new Error('Not authorized');

    await requirePaidSubscription(ctx as AnyCtx, args.venueId);

    const guest = await (ctx as AnyCtx).db.get(args.guestId);
    if (!guest) return null;
    if (guest.venueId !== args.venueId) throw new Error('Guest not found');
    const now = Date.now();
    await (ctx as AnyCtx).db.patch(guest._id, { deletedAt: now, updatedAt: now });
    return null;
  },
});
