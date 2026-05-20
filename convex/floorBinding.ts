import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';

const roleValue = v.union(v.literal('admin'), v.literal('owner'), v.literal('manager'));
const holdTypeValue = v.union(v.literal('reserved'), v.literal('held'), v.literal('seated'));
const sourceValue = v.union(v.literal('reservation'), v.literal('waitlist'));

function canEdit(role: string) {
  return role === 'admin' || role === 'owner' || role === 'manager';
}

function startOfDay(date: string) {
  return new Date(`${date}T00:00:00.000Z`).getTime();
}

function endOfDay(date: string) {
  return new Date(`${date}T23:59:59.999Z`).getTime();
}

function sourceLabel(source: string) {
  return source === 'opentable' ? 'OpenTable' : source === 'resy' ? 'Resy' : source === 'phone' ? 'Phone' : source === 'walk_in' ? 'Walk-in' : source === 'host' ? 'Host' : 'Direct';
}

async function loadFloorPlan(ctx: any, venueId: string) {
  return await ctx.db.query('floorPlans').withIndex('by_venue_active', (q: any) => q.eq('venueId', venueId).eq('isActive', true)).unique();
}

async function loadTableState(ctx: any, tableId: Id<'tables'>) {
  return await ctx.db.query('tableStates').withIndex('by_table', (q: any) => q.eq('tableId', tableId)).unique();
}

async function loadAssignmentSource(ctx: any, assignment: Doc<'tableAssignments'>) {
  if (assignment.reservationId) {
    const reservation = await ctx.db.get(assignment.reservationId);
    if (!reservation) return null;
    return {
      sourceType: 'reservation' as const,
      guestName: reservation.guestName,
      partySize: reservation.partySize,
      source: sourceLabel(reservation.source),
      startsAt: reservation.reservationTime,
      tags: reservation.tags ?? [],
      notes: reservation.specialRequests ?? null,
      status: reservation.status,
    };
  }

  if (assignment.waitlistId) {
    const waitlist = await ctx.db.get(assignment.waitlistId);
    if (!waitlist) return null;
    return {
      sourceType: 'waitlist' as const,
      guestName: waitlist.guestName,
      partySize: waitlist.partySize,
      source: sourceLabel(waitlist.source),
      startsAt: waitlist.requestedAt,
      tags: [],
      notes: waitlist.notes ?? null,
      status: waitlist.status,
    };
  }

  return null;
}

async function loadAssignmentsForTable(ctx: any, tableId: Id<'tables'>, now: number) {
  const assignments = await ctx.db.query('tableAssignments').withIndex('by_table_time', (q: any) => q.eq('tableId', tableId)).collect();
  const hydrated = [] as Array<any>;
  for (const assignment of assignments) {
    if (assignment.releasedAt) continue;
    const source = await loadAssignmentSource(ctx, assignment);
    if (!source) continue;
    hydrated.push({ assignment, source });
  }
  hydrated.sort((left: { assignment: Doc<'tableAssignments'> }, right: { assignment: Doc<'tableAssignments'> }) => left.assignment.startsAt - right.assignment.startsAt);
  const activeWindowEnd = now + 2 * 60 * 60 * 1000;
  const activeAssignments = hydrated.filter(({ assignment }: { assignment: Doc<'tableAssignments'> }) => assignment.holdType !== 'seated' && assignment.startsAt <= activeWindowEnd && assignment.endsAt >= now);
  const nextAssignment = hydrated.find(({ assignment }: { assignment: Doc<'tableAssignments'> }) => assignment.startsAt > activeWindowEnd) ?? null;
  return {
    activeAssignments: activeAssignments.map(mapAssignmentRow),
    nextAssignment: nextAssignment ? mapAssignmentRow(nextAssignment) : null,
  };
}

function mapAssignmentRow(entry: any) {
  return {
    assignmentId: entry.assignment._id,
    holdType: entry.assignment.holdType,
    tableId: entry.assignment.tableId,
    reservationId: entry.assignment.reservationId ?? null,
    waitlistId: entry.assignment.waitlistId ?? null,
    startsAt: entry.assignment.startsAt,
    endsAt: entry.assignment.endsAt,
    createdAt: entry.assignment.createdAt,
    releasedAt: entry.assignment.releasedAt ?? null,
    releasedReason: entry.assignment.releasedReason ?? null,
    sourceType: entry.source.sourceType,
    guestName: entry.source.guestName,
    partySize: entry.source.partySize,
    source: entry.source.source,
    tags: entry.source.tags,
    notes: entry.source.notes,
    status: entry.source.status,
  };
}

async function loadTableWithAssignments(ctx: any, table: Doc<'tables'>, now: number) {
  const state = await loadTableState(ctx, table._id);
  const binding = await loadAssignmentsForTable(ctx, table._id, now);
  return {
    table: {
      _id: table._id,
      _creationTime: table._creationTime,
      floorPlanId: table.floorPlanId,
      label: table.label,
      shape: table.shape,
      seats: table.seats,
      x: table.x,
      y: table.y,
      width: table.width,
      height: table.height,
      rotation: table.rotation,
      section: table.section,
      minSpend: table.minSpend,
      isReservable: table.isReservable,
    },
    state: state
      ? {
          _id: state._id,
          _creationTime: state._creationTime,
          venueId: state.venueId,
          tableId: state.tableId,
          status: state.status,
          partySize: state.partySize ?? null,
          serverId: state.serverId ?? null,
          toastCheckGuid: state.toastCheckGuid ?? null,
          seatedAt: state.seatedAt ?? null,
          lastActivityAt: state.lastActivityAt,
          notes: state.notes ?? null,
        }
      : null,
    activeAssignments: binding.activeAssignments,
    nextAssignment: binding.nextAssignment,
  };
}

async function writeTableHistory(ctx: any, payload: { venueId: string; tableId: Id<'tables'>; fromStatus: string; toStatus: string; partySize: number | null; metadata?: Record<string, string | number | boolean | null> | null }) {
  await ctx.db.insert('tableStateHistory', {
    venueId: payload.venueId,
    tableId: payload.tableId,
    fromStatus: payload.fromStatus,
    toStatus: payload.toStatus,
    actorId: undefined,
    partySize: payload.partySize ?? undefined,
    timestamp: Date.now(),
    metadata: payload.metadata ?? undefined,
  });
}

async function applyTableStatus(ctx: any, venueId: string, tableId: Id<'tables'>, status: Doc<'tableStates'>['status'], partySize?: number | null, notes?: string | null) {
  const state = await loadTableState(ctx, tableId);
  const now = Date.now();
  const next = {
    venueId,
    tableId,
    status,
    partySize: partySize ?? null,
    serverId: undefined,
    toastCheckGuid: state?.toastCheckGuid ?? undefined,
    seatedAt: status === 'seated' ? state?.seatedAt ?? now : undefined,
    lastActivityAt: now,
    notes: notes ?? undefined,
  };
  if (state) await ctx.db.patch(state._id, next);
  else await ctx.db.insert('tableStates', next);
  await writeTableHistory(ctx, { venueId, tableId, fromStatus: state?.status ?? 'available', toStatus: status, partySize: partySize ?? null, metadata: { tableId: String(tableId) } });
}

async function findVenuePlan(ctx: any, venueId: string) {
  const plan = await loadFloorPlan(ctx, venueId);
  if (!plan) return null;
  const tables = await ctx.db.query('tables').withIndex('by_floor_plan', (q: any) => q.eq('floorPlanId', plan._id)).collect();
  return { plan, tables };
}

async function validateNoOverlap(ctx: any, tableIds: Id<'tables'>[], startsAt: number, endsAt: number) {
  for (const tableId of tableIds) {
    const assignments = await ctx.db.query('tableAssignments').withIndex('by_table_time', (q: any) => q.eq('tableId', tableId)).collect();
    const conflict = assignments.find((assignment: Doc<'tableAssignments'>) => !assignment.releasedAt && assignment.startsAt < endsAt && assignment.endsAt > startsAt);
    if (conflict) throw new Error('Table already has an overlapping hold');
  }
}

async function assignToTables(ctx: any, args: { venueId: string; tableIds: Id<'tables'>[]; holdType: 'reserved' | 'held' | 'seated'; startsAt: number; endsAt: number; reservationId?: Id<'reservations'>; waitlistId?: Id<'waitlist'>; sourceType: 'reservation' | 'waitlist'; }) {
  const venue = await findVenuePlan(ctx, args.venueId);
  if (!venue) throw new Error('Floor plan not found');
  await validateNoOverlap(ctx, args.tableIds, args.startsAt, args.endsAt);

  const createdAt = Date.now();
  for (const tableId of args.tableIds) {
    await ctx.db.insert('tableAssignments', {
      venueId: args.venueId,
      reservationId: args.reservationId,
      waitlistId: args.waitlistId,
      tableId,
      holdType: args.holdType,
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      createdAt,
      releasedAt: undefined,
      releasedReason: undefined,
    });
    await applyTableStatus(ctx, args.venueId, tableId, args.holdType === 'seated' ? 'seated' : args.holdType === 'held' ? 'held' : 'reserved', args.sourceType === 'reservation' ? undefined : undefined);
  }

  if (args.reservationId) {
    const reservation = await ctx.db.get(args.reservationId);
    if (reservation) {
      await ctx.db.patch(reservation._id, { status: args.holdType === 'seated' ? 'seated' : 'confirmed', updatedAt: Date.now() });
    }
  }

  if (args.waitlistId) {
    const waitlist = await ctx.db.get(args.waitlistId);
    if (waitlist) {
      await ctx.db.patch(waitlist._id, { status: args.holdType === 'seated' ? 'seated' : 'assigned', updatedAt: Date.now() });
    }
  }
}

export const getActiveFloorPlan = query({
  args: { venueId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const venue = await findVenuePlan(ctx, args.venueId);
    if (!venue) return null;
    const now = Date.now();
    const tables = [] as Array<any>;
    for (const table of venue.tables) {
      tables.push(await loadTableWithAssignments(ctx, table, now));
    }
    return {
      floorPlan: {
        _id: venue.plan._id,
        _creationTime: venue.plan._creationTime,
        venueId: venue.plan.venueId,
        name: venue.plan.name,
        width: venue.plan.width,
        height: venue.plan.height,
        backgroundImageUrl: venue.plan.backgroundImageUrl ?? null,
        isActive: venue.plan.isActive,
        createdAt: venue.plan.createdAt,
        updatedAt: venue.plan.updatedAt,
      },
      tables,
    };
  },
});

export const getTableTimeline = query({
  args: { tableId: v.id('tables'), date: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const start = startOfDay(args.date);
    const end = endOfDay(args.date);
    const assignments = await ctx.db.query('tableAssignments').withIndex('by_table_time', (q: any) => q.eq('tableId', args.tableId)).collect();
    const dayAssignments = assignments.filter((assignment: Doc<'tableAssignments'>) => assignment.startsAt >= start && assignment.startsAt <= end);
    const output = [] as Array<any>;
    for (const assignment of dayAssignments.sort((a: { startsAt: number }, b: { startsAt: number }) => a.startsAt - b.startsAt)) {
      const source = await loadAssignmentSource(ctx, assignment);
      if (!source) continue;
      output.push(mapAssignmentRow({ assignment, source }));
    }
    return output;
  },
});

export const getUnassignedReservations = query({
  args: { venueId: v.string(), withinMinutes: v.number() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const windowEnd = now + Math.max(15, args.withinMinutes) * 60 * 1000;
    const reservations = await ctx.db.query('reservations').withIndex('by_venue_time', (q: any) => q.eq('venueId', args.venueId)).collect();
    const queue = [] as Array<any>;
    for (const reservation of reservations) {
      if (reservation.status !== 'confirmed' || reservation.reservationTime < now || reservation.reservationTime > windowEnd) continue;
      const assignments = await ctx.db.query('tableAssignments').withIndex('by_reservation', (q: any) => q.eq('reservationId', reservation._id)).collect();
      const active = assignments.some((assignment: Doc<'tableAssignments'>) => !assignment.releasedAt);
      if (active) continue;
      queue.push({
        id: reservation._id,
        guestName: reservation.guestName,
        partySize: reservation.partySize,
        reservationTime: reservation.reservationTime,
        durationMinutes: reservation.durationMinutes,
        source: reservation.source,
        tags: reservation.tags ?? [],
        specialRequests: reservation.specialRequests ?? null,
        status: reservation.status,
        externalId: reservation.externalId ?? null,
      });
    }
    return queue;
  },
});

export const getOpenWaitlist = query({
  args: { venueId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const waitlist = await ctx.db.query('waitlist').withIndex('by_venue_time', (q: any) => q.eq('venueId', args.venueId)).collect();
    return waitlist
      .filter((item: Doc<'waitlist'>) => item.status === 'waiting' || item.status === 'assigned')
      .sort((a: Doc<'waitlist'>, b: Doc<'waitlist'>) => a.requestedAt - b.requestedAt)
      .map((item: Doc<'waitlist'>) => ({
        id: item._id,
        guestName: item.guestName,
        partySize: item.partySize,
        requestedAt: item.requestedAt,
        source: item.source,
        status: item.status,
        notes: item.notes ?? null,
      }));
  },
});

export const assignReservationToTables = mutation({
  args: {
    venueId: v.string(),
    reservationId: v.id('reservations'),
    tableIds: v.array(v.id('tables')),
    holdType: holdTypeValue,
    startsAt: v.number(),
    endsAt: v.number(),
    actorRole: roleValue,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!canEdit(args.actorRole)) throw new Error('Not authorized');
    await assignToTables(ctx, { venueId: args.venueId, tableIds: args.tableIds, holdType: args.holdType, startsAt: args.startsAt, endsAt: args.endsAt, reservationId: args.reservationId, sourceType: 'reservation' });
    return null;
  },
});

export const assignWaitlistToTables = mutation({
  args: {
    venueId: v.string(),
    waitlistId: v.id('waitlist'),
    tableIds: v.array(v.id('tables')),
    holdType: holdTypeValue,
    startsAt: v.number(),
    endsAt: v.number(),
    actorRole: roleValue,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!canEdit(args.actorRole)) throw new Error('Not authorized');
    await assignToTables(ctx, { venueId: args.venueId, tableIds: args.tableIds, holdType: args.holdType, startsAt: args.startsAt, endsAt: args.endsAt, waitlistId: args.waitlistId, sourceType: 'waitlist' });
    return null;
  },
});

export const releaseAssignment = mutation({
  args: { venueId: v.string(), assignmentId: v.id('tableAssignments'), reason: v.string(), actorRole: roleValue },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!canEdit(args.actorRole)) throw new Error('Not authorized');
    const assignment = await ctx.db.get(args.assignmentId);
    if (!assignment) throw new Error('Assignment not found');
    if (assignment.venueId !== args.venueId) throw new Error('Wrong venue');
    if (assignment.releasedAt) return null;
    await ctx.db.patch(assignment._id, { releasedAt: Date.now(), releasedReason: args.reason });
    const otherActive = await ctx.db.query('tableAssignments').withIndex('by_table_time', (q: any) => q.eq('tableId', assignment.tableId)).collect();
    const stillBusy = otherActive.some((item: Doc<'tableAssignments'>) => item._id !== assignment._id && !item.releasedAt && item.startsAt <= Date.now() && item.endsAt >= Date.now());
    if (!stillBusy) {
      await applyTableStatus(ctx, args.venueId, assignment.tableId, 'available', null, args.reason);
    }
    if (assignment.reservationId) {
      const reservation = await ctx.db.get(assignment.reservationId);
      if (reservation) await ctx.db.patch(reservation._id, { status: 'confirmed', updatedAt: Date.now() });
    }
    if (assignment.waitlistId) {
      const waitlist = await ctx.db.get(assignment.waitlistId);
      if (waitlist) await ctx.db.patch(waitlist._id, { status: 'waiting', updatedAt: Date.now() });
    }
    return null;
  },
});