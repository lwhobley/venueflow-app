import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { requireProfile, canManage, requireVenueMember } from './authz';

// ─── Queries ────────────────────────────────────────────────────────────────

export const listLeads = query({
  args: {
    venueId: v.id('venues'),
    status: v.optional(v.string()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, { venueId, status, search }) => {
    const profile = await requireVenueMember(ctx, venueId);
    if (!canManage(profile)) throw new Error('Manager access required');

    let leads;
    if (status) {
      leads = await ctx.db
        .query('crmLeads')
        .withIndex('by_venue_status', (q) => q.eq('venueId', venueId).eq('status', status as any))
        .filter((q) => q.eq(q.field('deletedAt'), undefined))
        .order('desc')
        .collect();
    } else {
      leads = await ctx.db
        .query('crmLeads')
        .withIndex('by_venue', (q) => q.eq('venueId', venueId))
        .filter((q) => q.eq(q.field('deletedAt'), undefined))
        .order('desc')
        .collect();
    }

    if (search) {
      const q = search.toLowerCase();
      leads = leads.filter(
        (l) =>
          l.fullName.toLowerCase().includes(q) ||
          (l.company ?? '').toLowerCase().includes(q) ||
          (l.email ?? '').toLowerCase().includes(q) ||
          l.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    const profileIds = [...new Set(leads.map((l) => l.assignedToId).filter(Boolean) as Id<'profiles'>[])];
    const assignees = await Promise.all(profileIds.map((id) => ctx.db.get(id)));
    const assigneeMap = Object.fromEntries(
      assignees.filter(Boolean).map((p: any) => [p!._id, p!.fullName as string]),
    );

    return leads.map((l) => ({
      ...l,
      assignedToName: l.assignedToId ? (assigneeMap[l.assignedToId] ?? null) : null,
    }));
  },
});

export const getLead = query({
  args: { venueId: v.id('venues'), leadId: v.id('crmLeads') },
  handler: async (ctx, { venueId, leadId }) => {
    const profile = await requireVenueMember(ctx, venueId);
    if (!canManage(profile)) throw new Error('Manager access required');

    const lead = await ctx.db.get(leadId);
    if (!lead || lead.venueId !== venueId) return null;

    const [notes, beos, contracts, activityLog] = await Promise.all([
      ctx.db
        .query('crmNotes')
        .withIndex('by_lead_time', (q) => q.eq('leadId', leadId))
        .order('desc')
        .collect(),
      ctx.db
        .query('crmBeos')
        .withIndex('by_lead', (q) => q.eq('leadId', leadId))
        .order('desc')
        .collect(),
      ctx.db
        .query('crmContracts')
        .withIndex('by_lead', (q) => q.eq('leadId', leadId))
        .order('desc')
        .collect(),
      ctx.db
        .query('crmActivityLog')
        .withIndex('by_lead_time', (q) => q.eq('leadId', leadId))
        .order('desc')
        .take(50),
    ]);

    const authorIds = [...new Set(notes.map((n) => n.authorId))];
    const authors = await Promise.all(authorIds.map((id) => ctx.db.get(id)));
    const authorMap = Object.fromEntries(
      authors.filter(Boolean).map((p: any) => [p!._id, p!.fullName as string]),
    );

    return {
      lead,
      notes: notes.map((n) => ({ ...n, authorName: authorMap[n.authorId] ?? 'Unknown' })),
      beos,
      contracts,
      activityLog,
    };
  },
});

export const listBeos = query({
  args: { venueId: v.id('venues'), status: v.optional(v.string()) },
  handler: async (ctx, { venueId, status }) => {
    const profile = await requireVenueMember(ctx, venueId);
    if (!canManage(profile)) throw new Error('Manager access required');

    let beos;
    if (status) {
      beos = await ctx.db
        .query('crmBeos')
        .withIndex('by_venue_status', (q) => q.eq('venueId', venueId).eq('status', status as any))
        .order('desc')
        .collect();
    } else {
      beos = await ctx.db
        .query('crmBeos')
        .withIndex('by_venue', (q) => q.eq('venueId', venueId))
        .order('desc')
        .collect();
    }

    const leadIds = [...new Set(beos.map((b) => b.leadId).filter(Boolean) as Id<'crmLeads'>[])];
    const leads = await Promise.all(leadIds.map((id) => ctx.db.get(id)));
    const leadMap = Object.fromEntries(
      leads.filter(Boolean).map((l: any) => [l!._id, l!.fullName as string]),
    );

    return beos.map((b) => ({
      ...b,
      leadName: b.leadId ? (leadMap[b.leadId] ?? null) : null,
    }));
  },
});

export const listContracts = query({
  args: { venueId: v.id('venues'), status: v.optional(v.string()) },
  handler: async (ctx, { venueId, status }) => {
    const profile = await requireVenueMember(ctx, venueId);
    if (!canManage(profile)) throw new Error('Manager access required');

    let contracts;
    if (status) {
      contracts = await ctx.db
        .query('crmContracts')
        .withIndex('by_venue_status', (q) => q.eq('venueId', venueId).eq('status', status as any))
        .order('desc')
        .collect();
    } else {
      contracts = await ctx.db
        .query('crmContracts')
        .withIndex('by_venue', (q) => q.eq('venueId', venueId))
        .order('desc')
        .collect();
    }

    const leadIds = [...new Set(contracts.map((c) => c.leadId).filter(Boolean) as Id<'crmLeads'>[])];
    const leads = await Promise.all(leadIds.map((id) => ctx.db.get(id)));
    const leadMap = Object.fromEntries(
      leads.filter(Boolean).map((l: any) => [l!._id, l!.fullName as string]),
    );

    return contracts.map((c) => ({
      ...c,
      leadName: c.leadId ? (leadMap[c.leadId] ?? null) : null,
    }));
  },
});

// ─── Mutations ──────────────────────────────────────────────────────────────

export const saveLead = mutation({
  args: {
    venueId: v.id('venues'),
    leadId: v.optional(v.id('crmLeads')),
    fullName: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    company: v.optional(v.string()),
    source: v.optional(v.string()),
    status: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    assignedToId: v.optional(v.id('profiles')),
    marketingOptIn: v.optional(v.boolean()),
    estimatedValueCents: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const profile = await requireVenueMember(ctx, args.venueId);
    if (!canManage(profile)) throw new Error('Manager access required');

    const now = Date.now();

    if (args.leadId) {
      const existing = await ctx.db.get(args.leadId);
      if (!existing || existing.venueId !== args.venueId) throw new Error('Lead not found');

      const patch: Record<string, any> = { updatedAt: now, lastActivityAt: now };
      if (args.fullName !== undefined) patch.fullName = args.fullName;
      if (args.email !== undefined) patch.email = args.email;
      if (args.phone !== undefined) patch.phone = args.phone;
      if (args.company !== undefined) patch.company = args.company;
      if (args.source !== undefined) patch.source = args.source;
      if (args.status !== undefined) patch.status = args.status;
      if (args.tags !== undefined) patch.tags = args.tags;
      if (args.assignedToId !== undefined) patch.assignedToId = args.assignedToId;
      if (args.marketingOptIn !== undefined) patch.marketingOptIn = args.marketingOptIn;
      if (args.estimatedValueCents !== undefined) patch.estimatedValueCents = args.estimatedValueCents;

      await ctx.db.patch(args.leadId, patch);

      if (args.status && args.status !== existing.status) {
        await ctx.db.insert('crmActivityLog', {
          venueId: args.venueId,
          leadId: args.leadId,
          actorId: profile._id,
          kind: 'status_changed',
          detail: `${existing.status} → ${args.status}`,
          createdAt: now,
        });
      }

      return args.leadId;
    }

    const leadId = await ctx.db.insert('crmLeads', {
      venueId: args.venueId,
      fullName: args.fullName,
      email: args.email,
      phone: args.phone,
      company: args.company,
      source: args.source,
      status: (args.status ?? 'new') as any,
      tags: args.tags ?? [],
      assignedToId: args.assignedToId,
      marketingOptIn: args.marketingOptIn,
      estimatedValueCents: args.estimatedValueCents,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert('crmActivityLog', {
      venueId: args.venueId,
      leadId,
      actorId: profile._id,
      kind: 'lead_created',
      detail: `Lead created with status: ${args.status ?? 'new'}`,
      createdAt: now,
    });

    return leadId;
  },
});

export const addNote = mutation({
  args: {
    venueId: v.id('venues'),
    leadId: v.id('crmLeads'),
    text: v.string(),
  },
  handler: async (ctx, { venueId, leadId, text }) => {
    const profile = await requireVenueMember(ctx, venueId);
    if (!canManage(profile)) throw new Error('Manager access required');

    const lead = await ctx.db.get(leadId);
    if (!lead || lead.venueId !== venueId) throw new Error('Lead not found');

    const now = Date.now();
    const noteId = await ctx.db.insert('crmNotes', {
      venueId,
      leadId,
      authorId: profile._id,
      text: text.trim(),
      createdAt: now,
    });

    await ctx.db.patch(leadId, { lastActivityAt: now, updatedAt: now });

    await ctx.db.insert('crmActivityLog', {
      venueId,
      leadId,
      actorId: profile._id,
      kind: 'note_added',
      detail: text.trim().slice(0, 80),
      createdAt: now,
    });

    return noteId;
  },
});

export const saveBeo = mutation({
  args: {
    venueId: v.id('venues'),
    beoId: v.optional(v.id('crmBeos')),
    leadId: v.optional(v.id('crmLeads')),
    eventName: v.string(),
    eventDate: v.optional(v.number()),
    eventType: v.optional(v.string()),
    guestCount: v.optional(v.number()),
    venueSpace: v.optional(v.string()),
    setupStyle: v.optional(v.string()),
    fbMinimumCents: v.optional(v.number()),
    depositCents: v.optional(v.number()),
    depositDueDate: v.optional(v.number()),
    menuAppetizers: v.optional(v.string()),
    menuEntrees: v.optional(v.string()),
    menuDesserts: v.optional(v.string()),
    menuBarPackage: v.optional(v.string()),
    specialRequirements: v.optional(v.string()),
    internalNotes: v.optional(v.string()),
    assignedRepId: v.optional(v.id('profiles')),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const profile = await requireVenueMember(ctx, args.venueId);
    if (!canManage(profile)) throw new Error('Manager access required');
    const now = Date.now();

    const fields = {
      venueId: args.venueId,
      leadId: args.leadId,
      eventName: args.eventName,
      eventDate: args.eventDate,
      eventType: args.eventType,
      guestCount: args.guestCount,
      venueSpace: args.venueSpace,
      setupStyle: args.setupStyle,
      fbMinimumCents: args.fbMinimumCents,
      depositCents: args.depositCents,
      depositDueDate: args.depositDueDate,
      menuAppetizers: args.menuAppetizers,
      menuEntrees: args.menuEntrees,
      menuDesserts: args.menuDesserts,
      menuBarPackage: args.menuBarPackage,
      specialRequirements: args.specialRequirements,
      internalNotes: args.internalNotes,
      assignedRepId: args.assignedRepId,
      status: (args.status ?? 'draft') as any,
      updatedAt: now,
    };

    if (args.beoId) {
      await ctx.db.patch(args.beoId, fields);
      return args.beoId;
    }

    const beoId = await ctx.db.insert('crmBeos', { ...fields, createdAt: now });

    if (args.leadId) {
      const lead = await ctx.db.get(args.leadId);
      if (lead) {
        await ctx.db.patch(args.leadId, { lastActivityAt: now, updatedAt: now });
        await ctx.db.insert('crmActivityLog', {
          venueId: args.venueId,
          leadId: args.leadId,
          actorId: profile._id,
          kind: 'beo_created',
          detail: `BEO created: ${args.eventName}`,
          createdAt: now,
        });
      }
    }

    return beoId;
  },
});

export const saveContract = mutation({
  args: {
    venueId: v.id('venues'),
    contractId: v.optional(v.id('crmContracts')),
    leadId: v.optional(v.id('crmLeads')),
    beoId: v.optional(v.id('crmBeos')),
    eventName: v.optional(v.string()),
    eventDate: v.optional(v.number()),
    guestCount: v.optional(v.number()),
    venueSpace: v.optional(v.string()),
    fbMinimumCents: v.optional(v.number()),
    paymentSchedule: v.optional(v.array(v.object({
      amountCents: v.number(),
      dueDate: v.number(),
      type: v.union(v.literal('deposit'), v.literal('installment'), v.literal('final')),
    }))),
    cancellationPolicy: v.optional(v.string()),
    forceMajeure: v.optional(v.boolean()),
    liabilityWaiver: v.optional(v.boolean()),
    customClauses: v.optional(v.array(v.string())),
    clientSignatureName: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const profile = await requireVenueMember(ctx, args.venueId);
    if (!canManage(profile)) throw new Error('Manager access required');
    const now = Date.now();

    if (args.contractId) {
      const patch: Record<string, any> = { updatedAt: now };
      if (args.eventName !== undefined) patch.eventName = args.eventName;
      if (args.eventDate !== undefined) patch.eventDate = args.eventDate;
      if (args.guestCount !== undefined) patch.guestCount = args.guestCount;
      if (args.venueSpace !== undefined) patch.venueSpace = args.venueSpace;
      if (args.fbMinimumCents !== undefined) patch.fbMinimumCents = args.fbMinimumCents;
      if (args.paymentSchedule !== undefined) patch.paymentSchedule = args.paymentSchedule;
      if (args.cancellationPolicy !== undefined) patch.cancellationPolicy = args.cancellationPolicy;
      if (args.forceMajeure !== undefined) patch.forceMajeure = args.forceMajeure;
      if (args.liabilityWaiver !== undefined) patch.liabilityWaiver = args.liabilityWaiver;
      if (args.customClauses !== undefined) patch.customClauses = args.customClauses;
      if (args.clientSignatureName !== undefined) patch.clientSignatureName = args.clientSignatureName;
      if (args.status !== undefined) patch.status = args.status;
      await ctx.db.patch(args.contractId, patch);
      return args.contractId;
    }

    const contractNumber = `C-${now.toString(36).toUpperCase().slice(-6)}`;
    const contractId = await ctx.db.insert('crmContracts', {
      venueId: args.venueId,
      leadId: args.leadId,
      beoId: args.beoId,
      contractNumber,
      contractDate: now,
      eventName: args.eventName,
      eventDate: args.eventDate,
      guestCount: args.guestCount,
      venueSpace: args.venueSpace,
      fbMinimumCents: args.fbMinimumCents,
      paymentSchedule: args.paymentSchedule ?? [],
      cancellationPolicy: args.cancellationPolicy,
      forceMajeure: args.forceMajeure ?? false,
      liabilityWaiver: args.liabilityWaiver ?? false,
      customClauses: args.customClauses ?? [],
      clientSignatureName: args.clientSignatureName,
      status: (args.status ?? 'draft') as any,
      createdAt: now,
      updatedAt: now,
    });

    if (args.leadId) {
      const lead = await ctx.db.get(args.leadId);
      if (lead) {
        await ctx.db.patch(args.leadId, { lastActivityAt: now, updatedAt: now });
        await ctx.db.insert('crmActivityLog', {
          venueId: args.venueId,
          leadId: args.leadId,
          actorId: profile._id,
          kind: 'contract_created',
          detail: `Contract ${contractNumber} created`,
          createdAt: now,
        });
      }
    }

    return contractId;
  },
});

export const convertBeoToContract = mutation({
  args: {
    venueId: v.id('venues'),
    beoId: v.id('crmBeos'),
  },
  handler: async (ctx, { venueId, beoId }) => {
    const profile = await requireVenueMember(ctx, venueId);
    if (!canManage(profile)) throw new Error('Manager access required');

    const beo = await ctx.db.get(beoId);
    if (!beo || beo.venueId !== venueId) throw new Error('BEO not found');

    const now = Date.now();
    const contractNumber = `C-${now.toString(36).toUpperCase().slice(-6)}`;

    const contractId = await ctx.db.insert('crmContracts', {
      venueId,
      leadId: beo.leadId,
      beoId,
      contractNumber,
      contractDate: now,
      eventName: beo.eventName,
      eventDate: beo.eventDate,
      guestCount: beo.guestCount,
      venueSpace: beo.venueSpace,
      fbMinimumCents: beo.fbMinimumCents,
      paymentSchedule: beo.depositCents ? [{ amountCents: beo.depositCents, dueDate: beo.depositDueDate ?? now, type: 'deposit' as const }] : [],
      cancellationPolicy: undefined,
      forceMajeure: false,
      liabilityWaiver: false,
      customClauses: [],
      status: 'draft' as const,
      createdAt: now,
      updatedAt: now,
    });

    if (beo.leadId) {
      await ctx.db.insert('crmActivityLog', {
        venueId,
        leadId: beo.leadId,
        actorId: profile._id,
        kind: 'contract_created',
        detail: `Contract ${contractNumber} converted from BEO: ${beo.eventName}`,
        createdAt: now,
      });
    }

    return contractId;
  },
});

export const deleteLead = mutation({
  args: { venueId: v.id('venues'), leadId: v.id('crmLeads') },
  handler: async (ctx, { venueId, leadId }) => {
    const profile = await requireVenueMember(ctx, venueId);
    if (!canManage(profile)) throw new Error('Manager access required');
    const lead = await ctx.db.get(leadId);
    if (!lead || lead.venueId !== venueId) throw new Error('Lead not found');
    await ctx.db.patch(leadId, { deletedAt: Date.now(), updatedAt: Date.now() });
  },
});
