import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { requireProfile, requireVenueManager } from './authz';

const shiftStatus = v.union(v.literal('scheduled'), v.literal('open'), v.literal('covered'));

function minutesToTime(minutes: number) {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${mins.toString().padStart(2, '0')} ${suffix}`;
}

const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dayLabel(index: number) {
  return dayLabels[index] ?? 'Day';
}

// A shift assigned to a member conflicts with availability when, for that day,
// the member has availability data and either an explicit unavailable window
// overlaps the shift, or no available window fully covers it.
function shiftConflictsWith(avail: Doc<'availability'>[], dayIndex: number, start: number, end: number): boolean {
  const dayRows = avail.filter((a) => a.dayIndex === dayIndex);
  if (dayRows.length === 0) return false; // no data → can't determine, don't flag
  const blocked = dayRows.some((a) => !a.available && a.startMinutes < end && a.endMinutes > start);
  if (blocked) return true;
  const covered = dayRows.some((a) => a.available && a.startMinutes <= start && a.endMinutes >= end);
  return !covered;
}

const availabilityRow = v.object({
  dayIndex: v.number(),
  startMinutes: v.number(),
  endMinutes: v.number(),
  available: v.boolean(),
});

// ---------- Availability (employee) ----------

export const getMyAvailability = query({
  args: {},
  returns: v.array(availabilityRow),
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const rows = await ctx.db
      .query('availability')
      .withIndex('by_profile', (q: any) => q.eq('profileId', profile._id))
      .collect();
    return rows.map((r: Doc<'availability'>) => ({
      dayIndex: r.dayIndex,
      startMinutes: r.startMinutes,
      endMinutes: r.endMinutes,
      available: r.available,
    }));
  },
});

export const setMyAvailability = mutation({
  args: { rows: v.array(availabilityRow) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (!profile.venueId) throw new Error('Your account is not assigned to a venue');
    // Replace the full set for this profile.
    const existing = await ctx.db
      .query('availability')
      .withIndex('by_profile', (q: any) => q.eq('profileId', profile._id))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);
    const now = Date.now();
    for (const row of args.rows) {
      await ctx.db.insert('availability', {
        venueId: profile.venueId,
        profileId: profile._id,
        dayIndex: row.dayIndex,
        startMinutes: row.startMinutes,
        endMinutes: row.endMinutes,
        available: row.available,
        updatedAt: now,
      });
    }
    return null;
  },
});

// ---------- Manager scheduling ----------

const managerShiftValue = v.object({
  _id: v.id('scheduleShifts'),
  dayIndex: v.number(),
  dayLabel: v.string(),
  startMinutes: v.number(),
  endMinutes: v.number(),
  startTime: v.string(),
  endTime: v.string(),
  jobTitle: v.string(),
  station: v.string(),
  status: shiftStatus,
  profileId: v.union(v.id('profiles'), v.null()),
  memberName: v.union(v.string(), v.null()),
  conflict: v.boolean(),
});

const staffValue = v.object({
  _id: v.id('profiles'),
  fullName: v.string(),
  role: v.string(),
  jobTitle: v.string(),
});

export const getManagerSchedule = query({
  args: { venueId: v.id('venues') },
  returns: v.object({
    shifts: v.array(managerShiftValue),
    staff: v.array(staffValue),
  }),
  handler: async (ctx, args) => {
    await requireVenueManager(ctx, args.venueId);
    const shifts = await ctx.db
      .query('scheduleShifts')
      .withIndex('by_venueId', (q: any) => q.eq('venueId', args.venueId))
      .collect();
    const staff = await ctx.db
      .query('profiles')
      .withIndex('by_venueId', (q: any) => q.eq('venueId', args.venueId))
      .collect();
    const allAvail = await ctx.db
      .query('availability')
      .withIndex('by_venue', (q: any) => q.eq('venueId', args.venueId))
      .collect();
    const nameById = new Map(staff.map((s: Doc<'profiles'>) => [s._id, s.fullName]));
    const availByProfile = new Map<string, Doc<'availability'>[]>();
    for (const a of allAvail) {
      const list = availByProfile.get(a.profileId) ?? [];
      list.push(a);
      availByProfile.set(a.profileId, list);
    }

    const mapped = shifts
      .sort((a: Doc<'scheduleShifts'>, b: Doc<'scheduleShifts'>) => a.dayIndex - b.dayIndex || a.startMinutes - b.startMinutes)
      .map((shift: Doc<'scheduleShifts'>) => {
        const conflict = shift.profileId
          ? shiftConflictsWith(availByProfile.get(shift.profileId) ?? [], shift.dayIndex, shift.startMinutes, shift.endMinutes)
          : false;
        return {
          _id: shift._id,
          dayIndex: shift.dayIndex,
          dayLabel: dayLabel(shift.dayIndex),
          startMinutes: shift.startMinutes,
          endMinutes: shift.endMinutes,
          startTime: minutesToTime(shift.startMinutes),
          endTime: minutesToTime(shift.endMinutes),
          jobTitle: shift.jobTitle,
          station: shift.station,
          status: shift.status,
          profileId: shift.profileId ?? null,
          memberName: shift.profileId ? nameById.get(shift.profileId) ?? null : null,
          conflict,
        };
      });

    return {
      shifts: mapped,
      staff: staff.map((s: Doc<'profiles'>) => ({ _id: s._id, fullName: s.fullName, role: s.role, jobTitle: s.jobTitle })),
    };
  },
});

export const createShift = mutation({
  args: {
    venueId: v.id('venues'),
    dayIndex: v.number(),
    startMinutes: v.number(),
    endMinutes: v.number(),
    jobTitle: v.string(),
    station: v.string(),
    profileId: v.optional(v.id('profiles')),
  },
  returns: v.id('scheduleShifts'),
  handler: async (ctx, args) => {
    await requireVenueManager(ctx, args.venueId);
    if (args.endMinutes <= args.startMinutes) throw new Error('End time must be after start time');
    return await ctx.db.insert('scheduleShifts', {
      venueId: args.venueId,
      profileId: args.profileId,
      dayIndex: args.dayIndex,
      startMinutes: args.startMinutes,
      endMinutes: args.endMinutes,
      jobTitle: args.jobTitle,
      station: args.station,
      status: args.profileId ? 'scheduled' : 'open',
    });
  },
});

export const assignShift = mutation({
  args: { venueId: v.id('venues'), shiftId: v.id('scheduleShifts'), profileId: v.id('profiles') },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireVenueManager(ctx, args.venueId);
    const shift = await ctx.db.get(args.shiftId);
    if (!shift || shift.venueId !== args.venueId) throw new Error('Shift not found');
    const member = await ctx.db.get(args.profileId);
    if (!member || member.venueId !== args.venueId) throw new Error('Staff member is not in this venue');
    await ctx.db.patch(shift._id, { profileId: args.profileId, status: 'scheduled' });
    return null;
  },
});

export const unassignShift = mutation({
  args: { venueId: v.id('venues'), shiftId: v.id('scheduleShifts') },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireVenueManager(ctx, args.venueId);
    const shift = await ctx.db.get(args.shiftId);
    if (!shift || shift.venueId !== args.venueId) throw new Error('Shift not found');
    await ctx.db.patch(shift._id, { profileId: undefined, status: 'open' });
    return null;
  },
});

export const deleteShift = mutation({
  args: { venueId: v.id('venues'), shiftId: v.id('scheduleShifts') },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireVenueManager(ctx, args.venueId);
    const shift = await ctx.db.get(args.shiftId);
    if (!shift || shift.venueId !== args.venueId) throw new Error('Shift not found');
    await ctx.db.delete(shift._id);
    return null;
  },
});

// ---------- Employee schedule ----------

const myShiftValue = v.object({
  _id: v.id('scheduleShifts'),
  dayIndex: v.number(),
  dayLabel: v.string(),
  startMinutes: v.number(),
  endMinutes: v.number(),
  startTime: v.string(),
  endTime: v.string(),
  jobTitle: v.string(),
  station: v.string(),
  status: shiftStatus,
  mine: v.boolean(),
  conflict: v.boolean(),
});

export const getMySchedule = query({
  args: {},
  returns: v.object({ mine: v.array(myShiftValue), open: v.array(myShiftValue) }),
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    if (!profile.venueId) return { mine: [], open: [] };
    const shifts = await ctx.db
      .query('scheduleShifts')
      .withIndex('by_venueId', (q: any) => q.eq('venueId', profile.venueId))
      .collect();
    const myAvail = await ctx.db
      .query('availability')
      .withIndex('by_profile', (q: any) => q.eq('profileId', profile._id))
      .collect();

    const toValue = (shift: Doc<'scheduleShifts'>) => ({
      _id: shift._id,
      dayIndex: shift.dayIndex,
      dayLabel: dayLabel(shift.dayIndex),
      startMinutes: shift.startMinutes,
      endMinutes: shift.endMinutes,
      startTime: minutesToTime(shift.startMinutes),
      endTime: minutesToTime(shift.endMinutes),
      jobTitle: shift.jobTitle,
      station: shift.station,
      status: shift.status,
      mine: shift.profileId === profile._id,
      conflict: shiftConflictsWith(myAvail, shift.dayIndex, shift.startMinutes, shift.endMinutes),
    });

    const sorted = shifts.sort(
      (a: Doc<'scheduleShifts'>, b: Doc<'scheduleShifts'>) => a.dayIndex - b.dayIndex || a.startMinutes - b.startMinutes,
    );
    return {
      mine: sorted.filter((s: Doc<'scheduleShifts'>) => s.profileId === profile._id).map(toValue),
      open: sorted.filter((s: Doc<'scheduleShifts'>) => s.status === 'open' && !s.profileId).map(toValue),
    };
  },
});

export const claimOpenShift = mutation({
  args: { shiftId: v.id('scheduleShifts') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (!profile.venueId) throw new Error('Your account is not assigned to a venue');
    const shift = await ctx.db.get(args.shiftId);
    if (!shift || shift.venueId !== profile.venueId) throw new Error('Shift not found');
    if (shift.profileId || shift.status !== 'open') throw new Error('This shift is no longer open');
    await ctx.db.patch(shift._id, { profileId: profile._id, status: 'covered' });
    return null;
  },
});

export const requestDropShift = mutation({
  args: { shiftId: v.id('scheduleShifts'), details: v.optional(v.string()) },
  returns: v.id('staffRequests'),
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (!profile.venueId) throw new Error('Your account is not assigned to a venue');
    const shift = await ctx.db.get(args.shiftId);
    if (!shift || shift.venueId !== profile.venueId) throw new Error('Shift not found');
    if (shift.profileId !== profile._id) throw new Error('You can only drop your own shifts');
    const now = Date.now();
    return await ctx.db.insert('staffRequests', {
      venueId: profile.venueId,
      profileId: profile._id,
      kind: 'drop_shift',
      status: 'pending',
      title: `Drop ${dayLabel(shift.dayIndex)} ${minutesToTime(shift.startMinutes)} shift`,
      details: args.details || 'Requesting to drop this shift.',
      requestedShiftId: shift._id,
      createdAt: now,
      updatedAt: now,
    });
  },
});
