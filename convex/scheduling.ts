import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  requireProfile,
  requireVenueManager,
  requireVenueMember,
} from "./authz";
import {
  autoAssignShifts,
  blockedDayIndexes,
  type EngineStaff,
  type EngineOpenShift,
} from "./autoScheduleEngine";

const OVERTIME_MINUTES = 40 * 60; // weekly overtime threshold

// Returns an existing shift for `profileId` that overlaps the given window on
// the same day, ignoring any shift ids in `exclude`. Null if none.
async function overlappingShift(
  ctx: any,
  venueId: Id<"venues">,
  profileId: Id<"profiles">,
  dayIndex: number,
  startMinutes: number,
  endMinutes: number,
  exclude: Set<string>,
): Promise<Doc<"scheduleShifts"> | null> {
  // Scoped to this venue/person/day so we never load another venue's schedule or
  // a year of unrelated shifts just to check one overlap.
  const shifts = await ctx.db
    .query("scheduleShifts")
    .withIndex("by_venue_profile_day", (q: any) =>
      q
        .eq("venueId", venueId)
        .eq("profileId", profileId)
        .eq("dayIndex", dayIndex),
    )
    .take(50);
  for (const s of shifts as Doc<"scheduleShifts">[]) {
    if (exclude.has(s._id)) continue;
    if (s.startMinutes < endMinutes && startMinutes < s.endMinutes) return s;
  }
  return null;
}

// Rejects assigning a member to a shift that overlaps another of their shifts
// on the same day. Used by every assignment path to prevent double-booking.
async function assertNoDoubleBook(
  ctx: any,
  venueId: Id<"venues">,
  profileId: Id<"profiles">,
  dayIndex: number,
  startMinutes: number,
  endMinutes: number,
  excludeShiftId?: Id<"scheduleShifts">,
) {
  const exclude = new Set<string>(excludeShiftId ? [excludeShiftId] : []);
  if (
    await overlappingShift(
      ctx,
      venueId,
      profileId,
      dayIndex,
      startMinutes,
      endMinutes,
      exclude,
    )
  ) {
    throw new Error(
      `That overlaps another shift this person already works on ${dayLabel(dayIndex)}.`,
    );
  }
}

// YYYY-MM-DD strings compare lexicographically in date order, so range overlap
// is a plain string comparison. Two inclusive ranges overlap when each starts
// on or before the other ends.
export function dateRangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

const shiftStatus = v.union(
  v.literal("scheduled"),
  v.literal("open"),
  v.literal("covered"),
);

function minutesToTime(minutes: number) {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${mins.toString().padStart(2, "0")} ${suffix}`;
}

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function dayLabel(index: number) {
  return dayLabels[index] ?? "Day";
}

async function notifyProfile(
  ctx: any,
  args: {
    venueId: Doc<"venues">["_id"];
    profileId: Doc<"profiles">["_id"];
    kind:
      | "shift_assigned"
      | "request_created"
      | "request_reviewed"
      | "swap_proposed"
      | "swap_reviewed";
    title: string;
    body: string;
  },
) {
  await ctx.db.insert("notificationEvents", {
    venueId: args.venueId,
    profileId: args.profileId,
    audience: "profile",
    kind: args.kind,
    title: args.title,
    body: args.body,
    readBy: [],
    createdAt: Date.now(),
  });
}

async function notifyManagers(
  ctx: any,
  args: {
    venueId: Doc<"venues">["_id"];
    kind:
      | "shift_assigned"
      | "request_created"
      | "request_reviewed"
      | "swap_proposed";
    title: string;
    body: string;
  },
) {
  await ctx.db.insert("notificationEvents", {
    venueId: args.venueId,
    audience: "managers",
    kind: args.kind,
    title: args.title,
    body: args.body,
    readBy: [],
    createdAt: Date.now(),
  });
}

// Inbox + push to the whole venue staff.
async function notifyStaffWithPush(
  ctx: any,
  args: {
    venueId: Id<"venues">;
    kind: "schedule_published";
    title: string;
    body: string;
  },
) {
  await ctx.db.insert("notificationEvents", {
    venueId: args.venueId,
    audience: "staff",
    kind: args.kind,
    title: args.title,
    body: args.body,
    readBy: [],
    createdAt: Date.now(),
  });
  await ctx.runMutation(internal.push.sendPushToAudience, {
    venueId: args.venueId,
    audience: "staff",
    title: args.title,
    body: args.body,
    data: { screen: "schedule" },
  });
}

function weeklyMinutesByProfile(
  shifts: Doc<"scheduleShifts">[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of shifts) {
    if (!s.profileId) continue;
    map.set(
      s.profileId,
      (map.get(s.profileId) ?? 0) + Math.max(0, s.endMinutes - s.startMinutes),
    );
  }
  return map;
}

// A shift assigned to a member conflicts with availability when, for that day,
// the member has availability data and either an explicit unavailable window
// overlaps the shift, or no available window fully covers it.
function shiftConflictsWith(
  avail: Doc<"availability">[],
  dayIndex: number,
  start: number,
  end: number,
): boolean {
  const dayRows = avail.filter((a) => a.dayIndex === dayIndex);
  if (dayRows.length === 0) return false; // no data → can't determine, don't flag
  const blocked = dayRows.some(
    (a) => !a.available && a.startMinutes < end && a.endMinutes > start,
  );
  if (blocked) return true;
  const covered = dayRows.some(
    (a) => a.available && a.startMinutes <= start && a.endMinutes >= end,
  );
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
      .query("availability")
      .withIndex("by_profile", (q: any) => q.eq("profileId", profile._id))
      .take(50);
    return rows.map((r: Doc<"availability">) => ({
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
    if (!profile.venueId)
      throw new Error("Your account is not assigned to a venue");

    // Replace the full set for this profile.
    const existing = await ctx.db
      .query("availability")
      .withIndex("by_profile", (q: any) => q.eq("profileId", profile._id))
      .take(50);
    for (const row of existing) await ctx.db.delete(row._id);
    const now = Date.now();
    for (const row of args.rows) {
      await ctx.db.insert("availability", {
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

// ---------- Blackout dates (manager-managed) ----------

const blackoutValue = v.object({
  _id: v.id("blackoutDates"),
  startDate: v.string(),
  endDate: v.string(),
  reason: v.string(),
});

export const listBlackouts = query({
  args: { venueId: v.id("venues") },
  returns: v.array(blackoutValue),
  handler: async (ctx, args) => {
    // Any venue member can see blackout dates (so employees know before requesting off).
    await requireVenueMember(ctx, args.venueId);
    const rows = await ctx.db
      .query("blackoutDates")
      .withIndex("by_venue", (q: any) => q.eq("venueId", args.venueId))
      .take(100);
    return rows
      .sort((a: Doc<"blackoutDates">, b: Doc<"blackoutDates">) =>
        a.startDate.localeCompare(b.startDate),
      )
      .map((r: Doc<"blackoutDates">) => ({
        _id: r._id,
        startDate: r.startDate,
        endDate: r.endDate,
        reason: r.reason,
      }));
  },
});

export const addBlackout = mutation({
  args: {
    venueId: v.id("venues"),
    startDate: v.string(),
    endDate: v.optional(v.string()),
    reason: v.string(),
  },
  returns: v.id("blackoutDates"),
  handler: async (ctx, args) => {
    const profile = await requireVenueManager(ctx, args.venueId);

    const start = args.startDate.trim();
    const end = args.endDate?.trim() || start;
    if (!isoDate.test(start) || !isoDate.test(end))
      throw new Error("Dates must be in YYYY-MM-DD format");
    if (end < start)
      throw new Error("End date must be on or after the start date");
    return await ctx.db.insert("blackoutDates", {
      venueId: args.venueId,
      startDate: start,
      endDate: end,
      reason: args.reason.trim() || "Blackout",
      createdBy: profile._id,
      createdAt: Date.now(),
    });
  },
});

export const removeBlackout = mutation({
  args: { venueId: v.id("venues"), blackoutId: v.id("blackoutDates") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const manager = await requireVenueManager(ctx, args.venueId);

    const row = await ctx.db.get(args.blackoutId);
    if (!row || row.venueId !== args.venueId)
      throw new Error("Blackout not found");
    await ctx.db.delete(row._id);
    return null;
  },
});

// ---------- Manager scheduling ----------

const managerShiftValue = v.object({
  _id: v.id("scheduleShifts"),
  dayIndex: v.number(),
  dayLabel: v.string(),
  startMinutes: v.number(),
  endMinutes: v.number(),
  startTime: v.string(),
  endTime: v.string(),
  jobTitle: v.string(),
  station: v.string(),
  notes: v.union(v.string(), v.null()),
  status: shiftStatus,
  profileId: v.union(v.id("profiles"), v.null()),
  memberName: v.union(v.string(), v.null()),
  conflict: v.boolean(),
});

const staffValue = v.object({
  _id: v.id("profiles"),
  fullName: v.string(),
  role: v.string(),
  jobTitle: v.string(),
  weeklyHours: v.number(),
  overtime: v.boolean(),
  availability: v.array(availabilityRow),
});

const schedulePublishStateValue = v.object({
  status: v.union(
    v.literal("draft"),
    v.literal("published"),
    v.literal("edited_after_publish"),
  ),
  publishedAt: v.union(v.number(), v.null()),
  updatedAfterPublishAt: v.union(v.number(), v.null()),
});

type VenueScheduleMeta = Doc<"venues"> & {
  schedulePublishedAt?: number;
  scheduleUpdatedAfterPublishAt?: number;
};

async function markScheduleEdited(ctx: any, venueId: Id<"venues">) {
  const venue = (await ctx.db.get(venueId)) as VenueScheduleMeta | null;
  if (!venue?.schedulePublishedAt) return;
  await ctx.db.patch(venueId, {
    scheduleUpdatedAfterPublishAt: Date.now(),
  } as any);
}

function schedulePublishState(venue: VenueScheduleMeta | null) {
  const publishedAt = venue?.schedulePublishedAt ?? null;
  const updatedAfterPublishAt = venue?.scheduleUpdatedAfterPublishAt ?? null;
  return {
    status: !publishedAt
      ? ("draft" as const)
      : updatedAfterPublishAt && updatedAfterPublishAt > publishedAt
        ? ("edited_after_publish" as const)
        : ("published" as const),
    publishedAt,
    updatedAfterPublishAt,
  };
}

export const getManagerSchedule = query({
  args: { venueId: v.id("venues") },
  returns: v.object({
    shifts: v.array(managerShiftValue),
    staff: v.array(staffValue),
    laborBudgetHours: v.union(v.number(), v.null()),
    totalScheduledHours: v.number(),
    publishState: schedulePublishStateValue,
  }),
  handler: async (ctx, args) => {
    const venue = await ctx.db.get(args.venueId);
    await requireVenueManager(ctx, args.venueId);
    const shifts = await ctx.db
      .query("scheduleShifts")
      .withIndex("by_venueId", (q: any) => q.eq("venueId", args.venueId))
      .take(500);
    const staff = await ctx.db
      .query("profiles")
      .withIndex("by_venueId", (q: any) => q.eq("venueId", args.venueId))
      .take(200);
    const allAvail = await ctx.db
      .query("availability")
      .withIndex("by_venue", (q: any) => q.eq("venueId", args.venueId))
      .take(500);
    const nameById = new Map(
      staff.map((s: Doc<"profiles">) => [s._id, s.fullName]),
    );
    const availByProfile = new Map<string, Doc<"availability">[]>();
    for (const a of allAvail) {
      const list = availByProfile.get(a.profileId) ?? [];
      list.push(a);
      availByProfile.set(a.profileId, list);
    }

    const mapped = shifts
      .sort(
        (a: Doc<"scheduleShifts">, b: Doc<"scheduleShifts">) =>
          a.dayIndex - b.dayIndex || a.startMinutes - b.startMinutes,
      )
      .map((shift: Doc<"scheduleShifts">) => {
        const conflict = shift.profileId
          ? shiftConflictsWith(
              availByProfile.get(shift.profileId) ?? [],
              shift.dayIndex,
              shift.startMinutes,
              shift.endMinutes,
            )
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
          notes: shift.notes ?? null,
          status: shift.status,
          profileId: shift.profileId ?? null,
          memberName: shift.profileId
            ? (nameById.get(shift.profileId) ?? null)
            : null,
          conflict,
        };
      });

    const weekly = weeklyMinutesByProfile(shifts);
    const totalScheduledMinutes = Array.from(weekly.values()).reduce(
      (sum, m) => sum + m,
      0,
    );

    return {
      shifts: mapped,
      staff: staff.map((s: Doc<"profiles">) => {
        const mins = weekly.get(s._id) ?? 0;
        return {
          _id: s._id,
          fullName: s.fullName,
          role: s.role,
          jobTitle: s.jobTitle,
          weeklyHours: Math.round((mins / 60) * 10) / 10,
          overtime: mins > OVERTIME_MINUTES,
          availability: (availByProfile.get(s._id) ?? [])
            .sort(
              (a: Doc<"availability">, b: Doc<"availability">) =>
                a.dayIndex - b.dayIndex || a.startMinutes - b.startMinutes,
            )
            .map((a: Doc<"availability">) => ({
              dayIndex: a.dayIndex,
              startMinutes: a.startMinutes,
              endMinutes: a.endMinutes,
              available: a.available,
            })),
        };
      }),
      laborBudgetHours: venue?.weeklyLaborBudgetHours ?? null,
      totalScheduledHours: Math.round((totalScheduledMinutes / 60) * 10) / 10,
      publishState: schedulePublishState(venue as VenueScheduleMeta | null),
    };
  },
});

// ---------- Auto-schedule ----------

// Loads the venue's staff into the engine's plain shape: their availability,
// the minutes/blocks they already work this week (assigned shifts), so the
// engine balances load and avoids double-booking against current assignments.
async function loadEngineInputs(
  ctx: any,
  venueId: Id<"venues">,
  weekStartDate?: string,
): Promise<{
  staff: EngineStaff[];
  open: EngineOpenShift[];
  nameById: Map<string, string>;
}> {
  const shifts = (await ctx.db
    .query("scheduleShifts")
    .withIndex("by_venueId", (q: any) => q.eq("venueId", venueId))
    .take(500)) as Doc<"scheduleShifts">[];
  const staff = (await ctx.db
    .query("profiles")
    .withIndex("by_venueId", (q: any) => q.eq("venueId", venueId))
    .take(200)) as Doc<"profiles">[];
  const allAvail = (await ctx.db
    .query("availability")
    .withIndex("by_venue", (q: any) => q.eq("venueId", venueId))
    .take(1000)) as Doc<"availability">[];

  const availByProfile = new Map<string, Doc<"availability">[]>();
  for (const a of allAvail) {
    const list = availByProfile.get(a.profileId) ?? [];
    list.push(a);
    availByProfile.set(a.profileId, list);
  }
  const assignedByProfile = new Map<string, Doc<"scheduleShifts">[]>();
  for (const s of shifts) {
    if (!s.profileId) continue;
    const list = assignedByProfile.get(s.profileId) ?? [];
    list.push(s);
    assignedByProfile.set(s.profileId, list);
  }

  // With a week anchor, approved time-off (stored as calendar-date ranges) maps
  // onto the week's day indexes so the engine never schedules over it.
  const blockedByProfile = new Map<string, Set<number>>();
  if (weekStartDate) {
    const requests = (await ctx.db
      .query("staffRequests")
      .withIndex("by_venueId", (q: any) => q.eq("venueId", venueId))
      .take(500)) as Doc<"staffRequests">[];
    for (const r of requests) {
      if (r.kind !== "time_off" || r.status !== "approved") continue;
      const start = r.requestedRangeStart ?? r.requestedForDate;
      const end = r.requestedRangeEnd ?? r.requestedForDate ?? start;
      if (!start || !end) continue;
      const set = blockedByProfile.get(r.profileId) ?? new Set<number>();
      for (const d of blockedDayIndexes(weekStartDate, start, end)) set.add(d);
      blockedByProfile.set(r.profileId, set);
    }
  }

  const engineStaff: EngineStaff[] = staff.map((s) => {
    const assigned = assignedByProfile.get(s._id) ?? [];
    return {
      profileId: s._id,
      role: s.role,
      jobTitle: s.jobTitle,
      availability: (availByProfile.get(s._id) ?? []).map((a) => ({
        dayIndex: a.dayIndex,
        startMinutes: a.startMinutes,
        endMinutes: a.endMinutes,
        available: a.available,
      })),
      assignedMinutes: assigned.reduce(
        (sum, sh) => sum + Math.max(0, sh.endMinutes - sh.startMinutes),
        0,
      ),
      assignedBlocks: assigned.map((sh) => ({
        dayIndex: sh.dayIndex,
        startMinutes: sh.startMinutes,
        endMinutes: sh.endMinutes,
      })),
      blockedDays: Array.from(blockedByProfile.get(s._id) ?? []),
    };
  });

  const open: EngineOpenShift[] = shifts
    .filter((s) => !s.profileId && s.status === "open")
    .map((s) => ({
      shiftId: s._id,
      dayIndex: s.dayIndex,
      startMinutes: s.startMinutes,
      endMinutes: s.endMinutes,
      jobTitle: s.jobTitle,
    }));

  const nameById = new Map(staff.map((s) => [s._id, s.fullName]));
  return { staff: engineStaff, open, nameById };
}

const proposalReason = v.union(
  v.literal("assigned"),
  v.literal("no_role_match"),
  v.literal("no_availability"),
  v.literal("all_double_booked"),
  v.literal("labor_cap"),
  v.literal("time_off"),
);

const autoProposalValue = v.object({
  shiftId: v.id("scheduleShifts"),
  dayIndex: v.number(),
  dayLabel: v.string(),
  startTime: v.string(),
  endTime: v.string(),
  jobTitle: v.string(),
  profileId: v.union(v.id("profiles"), v.null()),
  memberName: v.union(v.string(), v.null()),
  reason: proposalReason,
});

// Read-only preview: proposes assignments for every open shift without
// persisting. The manager reviews/edits, then commits via applyAutoSchedule.
export const previewAutoSchedule = query({
  args: { venueId: v.id("venues"), weekStartDate: v.optional(v.string()) },
  returns: v.object({
    proposals: v.array(autoProposalValue),
    filled: v.number(),
    unfilled: v.number(),
    openCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const venue = await ctx.db.get(args.venueId);
    await requireVenueManager(ctx, args.venueId);
    const { staff, open, nameById } = await loadEngineInputs(
      ctx,
      args.venueId,
      args.weekStartDate,
    );
    const maxWeeklyMinutes = venue?.weeklyLaborBudgetHours
      ? Math.round(venue.weeklyLaborBudgetHours * 60)
      : null;
    const result = autoAssignShifts(open, staff, { maxWeeklyMinutes });

    const openById = new Map(open.map((o) => [o.shiftId, o]));
    const proposals = result.proposals.map((p) => {
      const shift = openById.get(p.shiftId)!;
      return {
        shiftId: p.shiftId as Id<"scheduleShifts">,
        dayIndex: shift.dayIndex,
        dayLabel: dayLabel(shift.dayIndex),
        startTime: minutesToTime(shift.startMinutes),
        endTime: minutesToTime(shift.endMinutes),
        jobTitle: shift.jobTitle,
        profileId: (p.profileId as Id<"profiles">) ?? null,
        memberName: p.profileId ? (nameById.get(p.profileId) ?? null) : null,
        reason: p.reason,
      };
    });
    return {
      proposals,
      filled: result.filled,
      unfilled: result.unfilled,
      openCount: open.length,
    };
  },
});

// Commits a set of {shiftId, profileId} assignments produced by the preview
// (optionally after manager edits). Each assignment is re-validated server-side
// — membership, shift still open, and no double-booking — so a stale preview
// can never create an invalid schedule.
export const applyAutoSchedule = mutation({
  args: {
    venueId: v.id("venues"),
    assignments: v.array(
      v.object({
        shiftId: v.id("scheduleShifts"),
        profileId: v.id("profiles"),
      }),
    ),
  },
  returns: v.object({ assigned: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => {
    await requireVenueManager(ctx, args.venueId);
    let assigned = 0;
    let skipped = 0;
    for (const a of args.assignments) {
      const shift = await ctx.db.get(a.shiftId);
      if (!shift || shift.venueId !== args.venueId || shift.profileId) {
        skipped += 1;
        continue;
      }
      const member = await ctx.db.get(a.profileId);
      if (!member || member.venueId !== args.venueId) {
        skipped += 1;
        continue;
      }
      try {
        await assertNoDoubleBook(
          ctx,
          args.venueId,
          a.profileId,
          shift.dayIndex,
          shift.startMinutes,
          shift.endMinutes,
          shift._id,
        );
      } catch {
        skipped += 1;
        continue;
      }
      await ctx.db.patch(shift._id, {
        profileId: a.profileId,
        status: "scheduled",
      });
      await notifyProfile(ctx, {
        venueId: args.venueId,
        profileId: a.profileId,
        kind: "shift_assigned",
        title: "Shift assigned",
        body: `${dayLabel(shift.dayIndex)} ${minutesToTime(shift.startMinutes)}-${minutesToTime(shift.endMinutes)} · ${shift.jobTitle}`,
      });
      assigned += 1;
    }
    if (assigned > 0) await markScheduleEdited(ctx, args.venueId);
    return { assigned, skipped };
  },
});

export const createShift = mutation({
  args: {
    venueId: v.id("venues"),
    dayIndex: v.number(),
    startMinutes: v.number(),
    endMinutes: v.number(),
    jobTitle: v.string(),
    station: v.string(),
    profileId: v.optional(v.id("profiles")),
  },
  returns: v.id("scheduleShifts"),
  handler: async (ctx, args) => {
    const manager = await requireVenueManager(ctx, args.venueId);

    if (args.endMinutes <= args.startMinutes)
      throw new Error("End time must be after start time");
    if (args.profileId) {
      const member = await ctx.db.get(args.profileId);
      if (!member || member.venueId !== args.venueId)
        throw new Error("Staff member is not in this venue");
      await assertNoDoubleBook(
        ctx,
        args.venueId,
        args.profileId,
        args.dayIndex,
        args.startMinutes,
        args.endMinutes,
      );
    }
    const shiftId = await ctx.db.insert("scheduleShifts", {
      venueId: args.venueId,
      profileId: args.profileId,
      dayIndex: args.dayIndex,
      startMinutes: args.startMinutes,
      endMinutes: args.endMinutes,
      jobTitle: args.jobTitle,
      station: args.station,
      status: args.profileId ? "scheduled" : "open",
    });
    await markScheduleEdited(ctx, args.venueId);
    if (args.profileId) {
      await notifyProfile(ctx, {
        venueId: args.venueId,
        profileId: args.profileId,
        kind: "shift_assigned",
        title: "New shift assigned",
        body: `${dayLabel(args.dayIndex)} ${minutesToTime(args.startMinutes)}-${minutesToTime(args.endMinutes)} · ${args.jobTitle}`,
      });
    } else {
      await notifyManagers(ctx, {
        venueId: args.venueId,
        kind: "shift_assigned",
        title: "Open shift added",
        body: `${dayLabel(args.dayIndex)} ${minutesToTime(args.startMinutes)}-${minutesToTime(args.endMinutes)} needs coverage.`,
      });
    }
    return shiftId;
  },
});

export const updateShift = mutation({
  args: {
    venueId: v.id("venues"),
    shiftId: v.id("scheduleShifts"),
    dayIndex: v.number(),
    startMinutes: v.number(),
    endMinutes: v.number(),
    jobTitle: v.string(),
    station: v.string(),
    notes: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const manager = await requireVenueManager(ctx, args.venueId);

    if (args.endMinutes <= args.startMinutes)
      throw new Error("End time must be after start time");
    const shift = await ctx.db.get(args.shiftId);
    if (!shift || shift.venueId !== args.venueId)
      throw new Error("Shift not found");
    await ctx.db.patch(shift._id, {
      dayIndex: args.dayIndex,
      startMinutes: args.startMinutes,
      endMinutes: args.endMinutes,
      jobTitle: args.jobTitle.trim() || "Staff",
      station: args.station.trim() || "Floor",
      notes: args.notes?.trim() || undefined,
    });
    await markScheduleEdited(ctx, args.venueId);
    if (shift.profileId) {
      await ctx.scheduler.runAfter(
        0,
        internal.scheduleEmails.sendShiftChangedEmail,
        {
          venueId: args.venueId,
          profileId: shift.profileId,
          shiftId: shift._id,
        },
      );
    }
    return null;
  },
});

export const assignShift = mutation({
  args: {
    venueId: v.id("venues"),
    shiftId: v.id("scheduleShifts"),
    profileId: v.id("profiles"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const manager = await requireVenueManager(ctx, args.venueId);

    const shift = await ctx.db.get(args.shiftId);
    if (!shift || shift.venueId !== args.venueId)
      throw new Error("Shift not found");
    const member = await ctx.db.get(args.profileId);
    if (!member || member.venueId !== args.venueId)
      throw new Error("Staff member is not in this venue");
    await assertNoDoubleBook(
      ctx,
      args.venueId,
      args.profileId,
      shift.dayIndex,
      shift.startMinutes,
      shift.endMinutes,
      shift._id,
    );
    await ctx.db.patch(shift._id, {
      profileId: args.profileId,
      status: "scheduled",
    });
    await markScheduleEdited(ctx, args.venueId);
    await notifyProfile(ctx, {
      venueId: args.venueId,
      profileId: args.profileId,
      kind: "shift_assigned",
      title: "Shift assigned",
      body: `${dayLabel(shift.dayIndex)} ${minutesToTime(shift.startMinutes)}-${minutesToTime(shift.endMinutes)} · ${shift.jobTitle}`,
    });
    return null;
  },
});

export const unassignShift = mutation({
  args: { venueId: v.id("venues"), shiftId: v.id("scheduleShifts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const manager = await requireVenueManager(ctx, args.venueId);

    const shift = await ctx.db.get(args.shiftId);
    if (!shift || shift.venueId !== args.venueId)
      throw new Error("Shift not found");
    await ctx.db.patch(shift._id, { profileId: undefined, status: "open" });
    await markScheduleEdited(ctx, args.venueId);
    return null;
  },
});

export const deleteShift = mutation({
  args: { venueId: v.id("venues"), shiftId: v.id("scheduleShifts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const manager = await requireVenueManager(ctx, args.venueId);

    const shift = await ctx.db.get(args.shiftId);
    if (!shift || shift.venueId !== args.venueId)
      throw new Error("Shift not found");
    await ctx.db.delete(shift._id);
    await markScheduleEdited(ctx, args.venueId);
    return null;
  },
});

// ---------- Employee schedule ----------

const myShiftValue = v.object({
  _id: v.id("scheduleShifts"),
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

const coworkerValue = v.object({
  profileId: v.id("profiles"),
  name: v.string(),
  jobTitle: v.string(),
  startTime: v.string(),
  endTime: v.string(),
  withMe: v.boolean(), // overlaps one of my shifts that day
});

const rosterDayValue = v.object({
  dayIndex: v.number(),
  dayLabel: v.string(),
  coworkers: v.array(coworkerValue),
});

export const getMySchedule = query({
  args: {},
  returns: v.object({
    mine: v.array(myShiftValue),
    open: v.array(myShiftValue),
    roster: v.array(rosterDayValue),
  }),
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    if (!profile.venueId) return { mine: [], open: [], roster: [] };
    const shifts = await ctx.db
      .query("scheduleShifts")
      .withIndex("by_venueId", (q: any) => q.eq("venueId", profile.venueId))
      .take(500);
    const myAvail = await ctx.db
      .query("availability")
      .withIndex("by_profile", (q: any) => q.eq("profileId", profile._id))
      .take(1000);
    const staff = await ctx.db
      .query("profiles")
      .withIndex("by_venueId", (q: any) => q.eq("venueId", profile.venueId))
      .take(500);
    const nameById = new Map(
      staff.map((s: Doc<"profiles">) => [s._id, s.fullName]),
    );

    const toValue = (shift: Doc<"scheduleShifts">) => ({
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
      conflict: shiftConflictsWith(
        myAvail,
        shift.dayIndex,
        shift.startMinutes,
        shift.endMinutes,
      ),
    });

    const sorted = shifts.sort(
      (a: Doc<"scheduleShifts">, b: Doc<"scheduleShifts">) =>
        a.dayIndex - b.dayIndex || a.startMinutes - b.startMinutes,
    );
    const mineShifts = sorted.filter(
      (s: Doc<"scheduleShifts">) => s.profileId === profile._id,
    );

    // For each day I work, list the coworkers also scheduled that day and flag
    // whether their shift overlaps mine ("on shift with").
    const myDays = Array.from(
      new Set(mineShifts.map((s: Doc<"scheduleShifts">) => s.dayIndex)),
    ).sort((a, b) => a - b);
    const roster = myDays.map((dayIndex) => {
      const myDayShifts = mineShifts.filter(
        (s: Doc<"scheduleShifts">) => s.dayIndex === dayIndex,
      );
      const coworkers = sorted
        .filter(
          (s: Doc<"scheduleShifts">) =>
            s.dayIndex === dayIndex &&
            s.profileId &&
            s.profileId !== profile._id,
        )
        .map((s: Doc<"scheduleShifts">) => ({
          profileId: s.profileId as Doc<"profiles">["_id"],
          name:
            nameById.get(s.profileId as Doc<"profiles">["_id"]) ?? "Teammate",
          jobTitle: s.jobTitle,
          startTime: minutesToTime(s.startMinutes),
          endTime: minutesToTime(s.endMinutes),
          withMe: myDayShifts.some(
            (m: Doc<"scheduleShifts">) =>
              m.startMinutes < s.endMinutes && s.startMinutes < m.endMinutes,
          ),
        }));
      return { dayIndex, dayLabel: dayLabel(dayIndex), coworkers };
    });

    return {
      mine: mineShifts.map(toValue),
      open: sorted
        .filter(
          (s: Doc<"scheduleShifts">) => s.status === "open" && !s.profileId,
        )
        .map(toValue),
      roster,
    };
  },
});

export const claimOpenShift = mutation({
  args: { shiftId: v.id("scheduleShifts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (!profile.venueId)
      throw new Error("Your account is not assigned to a venue");

    const shift = await ctx.db.get(args.shiftId);
    if (!shift || shift.venueId !== profile.venueId)
      throw new Error("Shift not found");
    if (shift.profileId || shift.status !== "open")
      throw new Error("This shift is no longer open");
    await assertNoDoubleBook(
      ctx,
      profile.venueId,
      profile._id,
      shift.dayIndex,
      shift.startMinutes,
      shift.endMinutes,
      shift._id,
    );
    await ctx.db.patch(shift._id, {
      profileId: profile._id,
      status: "covered",
    });
    await markScheduleEdited(ctx, profile.venueId);
    await notifyManagers(ctx, {
      venueId: profile.venueId,
      kind: "shift_assigned",
      title: "Open shift covered",
      body: `${profile.fullName} picked up ${dayLabel(shift.dayIndex)} ${minutesToTime(shift.startMinutes)}-${minutesToTime(shift.endMinutes)}.`,
    });
    return null;
  },
});

export const requestDropShift = mutation({
  args: { shiftId: v.id("scheduleShifts"), details: v.optional(v.string()) },
  returns: v.id("staffRequests"),
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    if (!profile.venueId)
      throw new Error("Your account is not assigned to a venue");

    const shift = await ctx.db.get(args.shiftId);
    if (!shift || shift.venueId !== profile.venueId)
      throw new Error("Shift not found");
    if (shift.profileId !== profile._id)
      throw new Error("You can only drop your own shifts");
    const now = Date.now();
    const requestId = await ctx.db.insert("staffRequests", {
      venueId: profile.venueId,
      profileId: profile._id,
      kind: "drop_shift",
      status: "pending",
      title: `Drop ${dayLabel(shift.dayIndex)} ${minutesToTime(shift.startMinutes)} shift`,
      details: args.details || "Requesting to drop this shift.",
      requestedShiftId: shift._id,
      createdAt: now,
      updatedAt: now,
    });
    await notifyManagers(ctx, {
      venueId: profile.venueId,
      kind: "request_created",
      title: "Drop shift request",
      body: `${profile.fullName} asked to drop ${dayLabel(shift.dayIndex)} ${minutesToTime(shift.startMinutes)}.`,
    });
    return requestId;
  },
});

// ---------- Publish & notify ----------

export const publishSchedule = mutation({
  args: { venueId: v.id("venues") },
  returns: v.object({ notified: v.number() }),
  handler: async (ctx, args) => {
    const profile = await requireVenueManager(ctx, args.venueId);

    const shifts = await ctx.db
      .query("scheduleShifts")
      .withIndex("by_venueId", (q: any) => q.eq("venueId", args.venueId))
      .take(500);
    const assigned = shifts.filter(
      (s: Doc<"scheduleShifts">) => s.profileId,
    ).length;
    const open = shifts.filter(
      (s: Doc<"scheduleShifts">) => s.status === "open",
    ).length;
    await ctx.db.patch(args.venueId, {
      schedulePublishedAt: Date.now(),
      schedulePublishedBy: profile._id,
      scheduleUpdatedAfterPublishAt: undefined,
    } as any);
    await notifyStaffWithPush(ctx, {
      venueId: args.venueId,
      kind: "schedule_published",
      title: "Schedule posted",
      body: `${assigned} shift${assigned === 1 ? "" : "s"} scheduled${open > 0 ? `, ${open} open to pick up` : ""}. Check your shifts.`,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.scheduleEmails.sendSchedulePublishedEmails,
      { venueId: args.venueId },
    );
    return { notified: assigned };
  },
});

export const setLaborBudget = mutation({
  args: {
    venueId: v.id("venues"),
    weeklyLaborBudgetHours: v.union(v.number(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const manager = await requireVenueManager(ctx, args.venueId);

    await ctx.db.patch(args.venueId, {
      weeklyLaborBudgetHours: args.weeklyLaborBudgetHours ?? undefined,
    });
    return null;
  },
});

// ---------- Templates & copy ----------

const templateValue = v.object({
  _id: v.id("scheduleTemplates"),
  name: v.string(),
  shiftCount: v.number(),
  createdAt: v.number(),
});

export const listScheduleTemplates = query({
  args: { venueId: v.id("venues") },
  returns: v.array(templateValue),
  handler: async (ctx, args) => {
    await requireVenueManager(ctx, args.venueId);
    const rows = await ctx.db
      .query("scheduleTemplates")
      .withIndex("by_venue", (q: any) => q.eq("venueId", args.venueId))
      .take(100);
    return rows
      .sort(
        (a: Doc<"scheduleTemplates">, b: Doc<"scheduleTemplates">) =>
          b.createdAt - a.createdAt,
      )
      .map((t: Doc<"scheduleTemplates">) => ({
        _id: t._id,
        name: t.name,
        shiftCount: t.shifts.length,
        createdAt: t.createdAt,
      }));
  },
});

export const saveScheduleTemplate = mutation({
  args: { venueId: v.id("venues"), name: v.string() },
  returns: v.id("scheduleTemplates"),
  handler: async (ctx, args) => {
    const manager = await requireVenueManager(ctx, args.venueId);

    const name = args.name.trim();
    if (!name) throw new Error("Enter a template name");
    const shifts = await ctx.db
      .query("scheduleShifts")
      .withIndex("by_venueId", (q: any) => q.eq("venueId", args.venueId))
      .take(500);
    return await ctx.db.insert("scheduleTemplates", {
      venueId: args.venueId,
      name,
      shifts: shifts.map((s: Doc<"scheduleShifts">) => ({
        dayIndex: s.dayIndex,
        startMinutes: s.startMinutes,
        endMinutes: s.endMinutes,
        jobTitle: s.jobTitle,
        station: s.station,
      })),
      createdAt: Date.now(),
    });
  },
});

export const applyScheduleTemplate = mutation({
  args: {
    venueId: v.id("venues"),
    templateId: v.id("scheduleTemplates"),
    replace: v.boolean(),
  },
  returns: v.object({ added: v.number() }),
  handler: async (ctx, args) => {
    const manager = await requireVenueManager(ctx, args.venueId);

    const template = await ctx.db.get(args.templateId);
    if (!template || template.venueId !== args.venueId)
      throw new Error("Template not found");
    if (args.replace) {
      const existing = await ctx.db
        .query("scheduleShifts")
        .withIndex("by_venueId", (q: any) => q.eq("venueId", args.venueId))
        .collect();
      for (const s of existing) await ctx.db.delete(s._id);
    }
    for (const slot of template.shifts) {
      await ctx.db.insert("scheduleShifts", {
        venueId: args.venueId,
        dayIndex: slot.dayIndex,
        startMinutes: slot.startMinutes,
        endMinutes: slot.endMinutes,
        jobTitle: slot.jobTitle,
        station: slot.station,
        status: "open", // templates are unassigned slots
      });
    }
    await markScheduleEdited(ctx, args.venueId);
    return { added: template.shifts.length };
  },
});

export const deleteScheduleTemplate = mutation({
  args: { venueId: v.id("venues"), templateId: v.id("scheduleTemplates") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const manager = await requireVenueManager(ctx, args.venueId);

    const template = await ctx.db.get(args.templateId);
    if (!template || template.venueId !== args.venueId)
      throw new Error("Template not found");
    await ctx.db.delete(template._id);
    return null;
  },
});

export const copyDayShifts = mutation({
  args: {
    venueId: v.id("venues"),
    fromDay: v.number(),
    toDays: v.array(v.number()),
  },
  returns: v.object({ added: v.number() }),
  handler: async (ctx, args) => {
    const manager = await requireVenueManager(ctx, args.venueId);

    const shifts = await ctx.db
      .query("scheduleShifts")
      .withIndex("by_venueId", (q: any) => q.eq("venueId", args.venueId))
      .take(500);
    const source = shifts.filter(
      (s: Doc<"scheduleShifts">) => s.dayIndex === args.fromDay,
    );
    let added = 0;
    for (const day of args.toDays) {
      if (day === args.fromDay) continue;
      for (const s of source) {
        await ctx.db.insert("scheduleShifts", {
          venueId: args.venueId,
          dayIndex: day,
          startMinutes: s.startMinutes,
          endMinutes: s.endMinutes,
          jobTitle: s.jobTitle,
          station: s.station,
          status: "open", // copied as unassigned slots
        });
        added++;
      }
    }
    await markScheduleEdited(ctx, args.venueId);
    return { added };
  },
});

const shiftSnapshot = v.object({
  dayIndex: v.number(),
  startMinutes: v.number(),
  endMinutes: v.number(),
  jobTitle: v.string(),
  station: v.string(),
  status: shiftStatus,
  profileId: v.union(v.id("profiles"), v.null()),
  notes: v.union(v.string(), v.null()),
});

export const clearWeek = mutation({
  args: { venueId: v.id("venues") },
  // Returns the removed shifts so the client can offer a one-tap undo.
  returns: v.object({ removed: v.number(), shifts: v.array(shiftSnapshot) }),
  handler: async (ctx, args) => {
    await requireVenueManager(ctx, args.venueId);

    const shifts = await ctx.db
      .query("scheduleShifts")
      .withIndex("by_venueId", (q: any) => q.eq("venueId", args.venueId))
      .collect();
    const snapshots = (shifts as Doc<"scheduleShifts">[]).map((s) => ({
      dayIndex: s.dayIndex,
      startMinutes: s.startMinutes,
      endMinutes: s.endMinutes,
      jobTitle: s.jobTitle,
      station: s.station,
      status: s.status,
      profileId: s.profileId ?? null,
      notes: s.notes ?? null,
    }));
    for (const s of shifts) await ctx.db.delete(s._id);
    await markScheduleEdited(ctx, args.venueId);
    return { removed: shifts.length, shifts: snapshots };
  },
});

// Re-inserts shift snapshots (undo for clearWeek / deleteShift). Silently
// drops any snapshot whose assignee is no longer in the venue.
export const restoreShifts = mutation({
  args: { venueId: v.id("venues"), shifts: v.array(shiftSnapshot) },
  returns: v.object({ restored: v.number() }),
  handler: async (ctx, args) => {
    await requireVenueManager(ctx, args.venueId);
    let restored = 0;
    for (const s of args.shifts) {
      if (s.dayIndex < 0 || s.dayIndex > 6 || !Number.isInteger(s.dayIndex)) {
        throw new Error(`Invalid dayIndex: ${s.dayIndex}`);
      }
      if (
        s.startMinutes < 0 ||
        s.startMinutes > 1440 ||
        !Number.isInteger(s.startMinutes)
      ) {
        throw new Error(`Invalid startMinutes: ${s.startMinutes}`);
      }
      if (
        s.endMinutes < 0 ||
        s.endMinutes > 1440 ||
        !Number.isInteger(s.endMinutes)
      ) {
        throw new Error(`Invalid endMinutes: ${s.endMinutes}`);
      }
      if (s.endMinutes <= s.startMinutes) {
        throw new Error("endMinutes must be greater than startMinutes");
      }
      const jobTitle = s.jobTitle.trim().slice(0, 100);
      const station = s.station.trim().slice(0, 100);
      const notes = s.notes != null ? s.notes.trim().slice(0, 500) : undefined;

      let profileId = s.profileId ?? undefined;
      if (profileId) {
        const member = await ctx.db.get(profileId);
        if (!member || member.venueId !== args.venueId) profileId = undefined;
      }
      await ctx.db.insert("scheduleShifts", {
        venueId: args.venueId,
        profileId,
        dayIndex: s.dayIndex,
        startMinutes: s.startMinutes,
        endMinutes: s.endMinutes,
        jobTitle,
        station,
        status: profileId ? s.status : "open",
        notes,
      });
      restored += 1;
    }
    await markScheduleEdited(ctx, args.venueId);
    return { restored };
  },
});

// ---------- Peer shift swaps ----------

const swapValue = v.object({
  _id: v.id("shiftSwaps"),
  status: v.union(
    v.literal("proposed"),
    v.literal("accepted"),
    v.literal("declined"),
    v.literal("approved"),
    v.literal("denied"),
    v.literal("cancelled"),
  ),
  note: v.union(v.string(), v.null()),
  requesterName: v.string(),
  targetName: v.string(),
  requesterShift: v.string(),
  targetShift: v.union(v.string(), v.null()),
  direction: v.union(
    v.literal("incoming"),
    v.literal("outgoing"),
    v.literal("other"),
  ),
  createdAt: v.number(),
});

function shiftLabel(s: Doc<"scheduleShifts"> | null): string {
  if (!s) return "shift";
  return `${dayLabel(s.dayIndex)} ${minutesToTime(s.startMinutes)}–${minutesToTime(s.endMinutes)}`;
}

export const proposeShiftSwap = mutation({
  args: {
    myShiftId: v.id("scheduleShifts"),
    targetProfileId: v.id("profiles"),
    targetShiftId: v.optional(v.id("scheduleShifts")),
    note: v.optional(v.string()),
  },
  returns: v.id("shiftSwaps"),
  handler: async (ctx, args) => {
    const me = await requireProfile(ctx);
    if (!me.venueId) throw new Error("Your account is not assigned to a venue");

    const myShift = await ctx.db.get(args.myShiftId);
    if (
      !myShift ||
      myShift.venueId !== me.venueId ||
      myShift.profileId !== me._id
    )
      throw new Error("That is not your shift");
    const target = await ctx.db.get(args.targetProfileId);
    if (!target || target.venueId !== me.venueId || target._id === me._id)
      throw new Error("Invalid teammate");
    if (args.targetShiftId) {
      const ts = await ctx.db.get(args.targetShiftId);
      if (!ts || ts.venueId !== me.venueId || ts.profileId !== target._id)
        throw new Error("That is not the teammate's shift");
    }
    const now = Date.now();
    const swapId = await ctx.db.insert("shiftSwaps", {
      venueId: me.venueId,
      requesterProfileId: me._id,
      requesterShiftId: args.myShiftId,
      targetProfileId: args.targetProfileId,
      targetShiftId: args.targetShiftId,
      status: "proposed",
      note: args.note?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    });
    await notifyProfile(ctx, {
      venueId: me.venueId,
      profileId: target._id,
      kind: "swap_proposed",
      title: "Shift swap proposed",
      body: `${me.fullName} wants to swap ${shiftLabel(myShift)}.`,
    });
    return swapId;
  },
});

export const respondToShiftSwap = mutation({
  args: { swapId: v.id("shiftSwaps"), accept: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const me = await requireProfile(ctx);

    const swap = await ctx.db.get(args.swapId);
    if (!swap || swap.targetProfileId !== me._id)
      throw new Error("Not authorized");
    if (swap.status !== "proposed")
      throw new Error("This swap is no longer open");
    await ctx.db.patch(swap._id, {
      status: args.accept ? "accepted" : "declined",
      updatedAt: Date.now(),
    });
    if (args.accept && swap.venueId) {
      await notifyManagers(ctx, {
        venueId: swap.venueId,
        kind: "swap_proposed",
        title: "Swap needs approval",
        body: `${me.fullName} accepted a shift swap — approve it in the schedule.`,
      });
    }
    return null;
  },
});

export const reviewShiftSwap = mutation({
  args: { swapId: v.id("shiftSwaps"), approve: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const swap = await ctx.db.get(args.swapId);
    if (!swap) throw new Error("Swap not found");
    const manager = await requireVenueManager(ctx, swap.venueId);

    if (swap.status !== "accepted" && swap.status !== "proposed")
      throw new Error("Swap is not pending");

    if (args.approve) {
      const reqShift = await ctx.db.get(swap.requesterShiftId);
      const tShift = swap.targetShiftId
        ? await ctx.db.get(swap.targetShiftId)
        : null;
      // After the swap, each person drops the shift(s) involved here, so those
      // ids are excluded from the overlap check.
      const exclude = new Set<string>([
        swap.requesterShiftId as string,
        ...(swap.targetShiftId ? [swap.targetShiftId as string] : []),
      ]);
      if (reqShift) {
        const clash = await overlappingShift(
          ctx,
          swap.venueId,
          swap.targetProfileId,
          reqShift.dayIndex,
          reqShift.startMinutes,
          reqShift.endMinutes,
          exclude,
        );
        if (clash)
          throw new Error(
            `Swap would double-book ${(await ctx.db.get(swap.targetProfileId))?.fullName ?? "the teammate"} on ${dayLabel(reqShift.dayIndex)}.`,
          );
      }
      if (tShift) {
        const clash = await overlappingShift(
          ctx,
          swap.venueId,
          swap.requesterProfileId,
          tShift.dayIndex,
          tShift.startMinutes,
          tShift.endMinutes,
          exclude,
        );
        if (clash)
          throw new Error(
            `Swap would double-book ${(await ctx.db.get(swap.requesterProfileId))?.fullName ?? "the requester"} on ${dayLabel(tShift.dayIndex)}.`,
          );
      }
      if (reqShift)
        await ctx.db.patch(reqShift._id, {
          profileId: swap.targetProfileId,
          status: "scheduled",
        });
      if (tShift)
        await ctx.db.patch(tShift._id, {
          profileId: swap.requesterProfileId,
          status: "scheduled",
        });
      await markScheduleEdited(ctx, swap.venueId);
    }
    await ctx.db.patch(swap._id, {
      status: args.approve ? "approved" : "denied",
      updatedAt: Date.now(),
    });
    await notifyProfile(ctx, {
      venueId: swap.venueId,
      profileId: swap.requesterProfileId,
      kind: "swap_reviewed",
      title: `Swap ${args.approve ? "approved" : "denied"}`,
      body: `Your shift swap was ${args.approve ? "approved" : "denied"}.`,
    });
    await notifyProfile(ctx, {
      venueId: swap.venueId,
      profileId: swap.targetProfileId,
      kind: "swap_reviewed",
      title: `Swap ${args.approve ? "approved" : "denied"}`,
      body: `A shift swap was ${args.approve ? "approved" : "denied"}.`,
    });
    return null;
  },
});

async function mapSwaps(
  ctx: any,
  venueId: Id<"venues">,
  swaps: Doc<"shiftSwaps">[],
  meId: Id<"profiles"> | null,
) {
  const staff = await ctx.db
    .query("profiles")
    .withIndex("by_venueId", (q: any) => q.eq("venueId", venueId))
    .take(200);
  const nameById = new Map(
    staff.map((s: Doc<"profiles">) => [s._id, s.fullName]),
  );
  const out = [];
  for (const swap of swaps) {
    const reqShift = await ctx.db.get(swap.requesterShiftId);
    const tShift = swap.targetShiftId
      ? await ctx.db.get(swap.targetShiftId)
      : null;
    out.push({
      _id: swap._id,
      status: swap.status,
      note: swap.note ?? null,
      requesterName:
        (nameById.get(swap.requesterProfileId) as string) ?? "Teammate",
      targetName: (nameById.get(swap.targetProfileId) as string) ?? "Teammate",
      requesterShift: shiftLabel(reqShift),
      targetShift: tShift ? shiftLabel(tShift) : null,
      direction: (meId === swap.targetProfileId
        ? "incoming"
        : meId === swap.requesterProfileId
          ? "outgoing"
          : "other") as "incoming" | "outgoing" | "other",
      createdAt: swap.createdAt,
    });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export const getMyShiftSwaps = query({
  args: {},
  returns: v.array(swapValue),
  handler: async (ctx) => {
    const me = await requireProfile(ctx);
    if (!me.venueId) return [];
    const incoming = await ctx.db
      .query("shiftSwaps")
      .withIndex("by_target", (q: any) => q.eq("targetProfileId", me._id))
      .take(200);
    const outgoing = await ctx.db
      .query("shiftSwaps")
      .withIndex("by_requester", (q: any) => q.eq("requesterProfileId", me._id))
      .take(200);
    const seen = new Set<string>();
    const merged = [...incoming, ...outgoing].filter((s: Doc<"shiftSwaps">) => {
      if (seen.has(s._id)) return false;
      seen.add(s._id);
      return true;
    });
    return await mapSwaps(ctx, me.venueId, merged, me._id);
  },
});

export const listShiftSwaps = query({
  args: { venueId: v.id("venues") },
  returns: v.array(swapValue),
  handler: async (ctx, args) => {
    await requireVenueManager(ctx, args.venueId);
    const swaps = await ctx.db
      .query("shiftSwaps")
      .withIndex("by_venue", (q: any) => q.eq("venueId", args.venueId))
      .take(500);
    const pending = swaps.filter(
      (s: Doc<"shiftSwaps">) =>
        s.status === "accepted" || s.status === "proposed",
    );
    return await mapSwaps(ctx, args.venueId, pending, null);
  },
});
