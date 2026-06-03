import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireActiveSubscription } from "./billing/shared";

type Identity = {
  tokenIdentifier: string;
  email?: string | null;
  name?: string | null;
};

// NOTE: This is an intentional escape hatch. The helpers below are shared
// across query and mutation handlers, and the codebase stores venueId as a
// string rather than Id<'venues'>. Properly typing this (and migrating venueId
// to Id<'venues'>) is tracked as a dedicated hardening task. Until then, AnyCtx
// keeps the shared helpers usable from both ctx flavors without unsafe runtime
// behavior — Convex still validates every argument at the boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCtx = any;

// Every new account (and new venue) gets a 14-day free trial.
const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

const subscriptionStatusValue = v.union(
  v.literal("trialing"),
  v.literal("active"),
  v.literal("past_due"),
  v.literal("cancelled"),
  v.literal("expired"),
  v.literal("paused"),
);
const subscriptionPlatformValue = v.union(
  v.literal("stripe"),
  v.literal("apple"),
  v.null(),
);

const role = v.union(
  v.literal("admin"),
  v.literal("owner"),
  v.literal("manager"),
  v.literal("server"),
  v.literal("staff"),
);
const requestKind = v.union(
  v.literal("add_shift"),
  v.literal("drop_shift"),
  v.literal("time_off"),
  v.literal("availability"),
);
const requestStatus = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("denied"),
  v.literal("cancelled"),
);

const profileValue = v.object({
  _id: v.id("profiles"),
  _creationTime: v.number(),
  tokenIdentifier: v.union(v.string(), v.null()),
  email: v.string(),
  fullName: v.string(),
  role,
  jobTitle: v.string(),
  venueId: v.union(v.id("venues"), v.null()),
  allAccess: v.boolean(),
  trialEndsAt: v.union(v.number(), v.null()),
});

const venueValue = v.object({
  _id: v.id("venues"),
  _creationTime: v.number(),
  name: v.string(),
  latitude: v.number(),
  longitude: v.number(),
  geofenceRadiusM: v.number(),
  subscriptionStatus: v.union(subscriptionStatusValue, v.null()),
  subscriptionPlatform: subscriptionPlatformValue,
});

const scheduleShiftValue = v.object({
  _id: v.id("scheduleShifts"),
  _creationTime: v.number(),
  venueId: v.id("venues"),
  profileId: v.union(v.id("profiles"), v.null()),
  dayIndex: v.number(),
  startMinutes: v.number(),
  endMinutes: v.number(),
  jobTitle: v.string(),
  station: v.string(),
  notes: v.union(v.string(), v.null()),
  status: v.union(
    v.literal("scheduled"),
    v.literal("open"),
    v.literal("covered"),
  ),
  dayLabel: v.string(),
  memberName: v.string(),
  startTime: v.string(),
  endTime: v.string(),
});

const clockEntryValue = v.object({
  _id: v.id("timeEntries"),
  _creationTime: v.number(),
  memberId: v.id("profiles"),
  memberName: v.string(),
  role,
  jobTitle: v.string(),
  venueId: v.id("venues"),
  venueName: v.string(),
  clockInAt: v.number(),
  clockOutAt: v.union(v.number(), v.null()),
  clockInLat: v.number(),
  clockInLng: v.number(),
  clockInAccuracyM: v.number(),
  clockInMocked: v.boolean(),
  clockOutLat: v.union(v.number(), v.null()),
  clockOutLng: v.union(v.number(), v.null()),
  clockOutAccuracyM: v.union(v.number(), v.null()),
  clockOutMocked: v.union(v.boolean(), v.null()),
  isOpen: v.boolean(),
});

const staffRequestValue = v.object({
  _id: v.id("staffRequests"),
  _creationTime: v.number(),
  venueId: v.id("venues"),
  profileId: v.id("profiles"),
  kind: requestKind,
  status: requestStatus,
  title: v.string(),
  details: v.string(),
  requestedForDate: v.union(v.string(), v.null()),
  requestedShiftId: v.union(v.id("scheduleShifts"), v.null()),
  requestedRangeStart: v.union(v.string(), v.null()),
  requestedRangeEnd: v.union(v.string(), v.null()),
  availability: v.union(
    v.array(
      v.object({
        dayIndex: v.number(),
        startMinutes: v.number(),
        endMinutes: v.number(),
        available: v.boolean(),
      }),
    ),
    v.null(),
  ),
  reviewerId: v.union(v.id("profiles"), v.null()),
  reviewedAt: v.union(v.number(), v.null()),
  responseNotes: v.union(v.string(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const notificationEventValue = v.object({
  _id: v.id("notificationEvents"),
  kind: v.union(
    v.literal("shift_assigned"),
    v.literal("schedule_published"),
    v.literal("swap_proposed"),
    v.literal("swap_reviewed"),
    v.literal("request_created"),
    v.literal("request_reviewed"),
    v.literal("reservation_due"),
    v.literal("reservation_created"),
    v.literal("reservation_updated"),
    v.literal("clock_alert"),
  ),
  title: v.string(),
  body: v.string(),
  createdAt: v.number(),
  read: v.boolean(),
});

const managerAlertValue = v.object({
  kind: v.union(v.literal("late_clock_in"), v.literal("missed_clock_out")),
  severity: v.union(v.literal("warning"), v.literal("danger")),
  profileId: v.id("profiles"),
  memberName: v.string(),
  detail: v.string(),
});

function displayName(identity: Identity) {
  return (
    identity.name?.trim() || identity.email?.split("@")[0] || "Team member"
  );
}

function defaultJobTitle(roleName: string) {
  switch (roleName) {
    case "admin":
      return "Operations Admin";
    case "owner":
      return "Owner";
    case "manager":
      return "Shift Manager";
    case "server":
      return "Server";
    default:
      return "Team Member";
  }
}

function dayLabel(index: number) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][index] ?? "Day";
}

function minutesToTime(minutes: number) {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${mins.toString().padStart(2, "0")} ${suffix}`;
}

function csvCell(value: string | number | null | undefined) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

async function notifyProfile(
  ctx: AnyCtx,
  args: {
    venueId: Id<"venues">;
    profileId: Id<"profiles">;
    kind: "request_reviewed";
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
    createdAt: Date.now(),
  });
}

async function notifyManagers(
  ctx: AnyCtx,
  args: {
    venueId: Id<"venues">;
    kind: "request_created" | "clock_alert";
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
    createdAt: Date.now(),
  });
}

async function requireIdentity(ctx: AnyCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthenticated");
  return identity;
}

// Loads the profile for the currently-authenticated user using the stable
// Convex Auth user id. Returns null if unauthenticated or no profile yet.
async function getProfile(ctx: AnyCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return await ctx.db
    .query("profiles")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .unique();
}

function mapProfile(profile: Doc<"profiles">) {
  return {
    _id: profile._id,
    _creationTime: profile._creationTime,
    tokenIdentifier: profile.tokenIdentifier ?? null,
    email: profile.email,
    fullName: profile.fullName,
    role: profile.role,
    jobTitle: profile.jobTitle,
    venueId: profile.venueId ?? null,
    allAccess: profile.allAccess === true,
    trialEndsAt: profile.trialEndsAt ?? null,
  };
}

function mapVenue(venue: Doc<"venues">) {
  return {
    _id: venue._id,
    _creationTime: venue._creationTime,
    name: venue.name,
    latitude: venue.latitude,
    longitude: venue.longitude,
    geofenceRadiusM: venue.geofenceRadiusM,
    subscriptionStatus:
      (venue as Doc<"venues"> & { subscriptionStatus?: string | null })
        .subscriptionStatus ?? null,
    subscriptionPlatform:
      (venue as Doc<"venues"> & { subscriptionPlatform?: string | null })
        .subscriptionPlatform ?? null,
  };
}

function mapShift(shift: Doc<"scheduleShifts">, profileName: string | null) {
  return {
    _id: shift._id,
    _creationTime: shift._creationTime,
    venueId: shift.venueId,
    profileId: shift.profileId ?? null,
    dayIndex: shift.dayIndex,
    startMinutes: shift.startMinutes,
    endMinutes: shift.endMinutes,
    jobTitle: shift.jobTitle,
    station: shift.station,
    notes: shift.notes ?? null,
    status: shift.status,
    dayLabel: dayLabel(shift.dayIndex),
    memberName:
      profileName ?? (shift.status === "open" ? "Open shift" : "Unassigned"),
    startTime: minutesToTime(shift.startMinutes),
    endTime: minutesToTime(shift.endMinutes),
  };
}

function mapClockEntry(
  entry: Doc<"timeEntries">,
  profile: Doc<"profiles">,
  venue: Doc<"venues">,
) {
  return {
    _id: entry._id,
    _creationTime: entry._creationTime,
    memberId: profile._id,
    memberName: profile.fullName,
    role: profile.role,
    jobTitle: profile.jobTitle,
    venueId: venue._id,
    venueName: venue.name,
    clockInAt: entry.clockInAt,
    clockOutAt: entry.clockOutAt ?? null,
    clockInLat: entry.clockInLat,
    clockInLng: entry.clockInLng,
    clockInAccuracyM: entry.clockInAccuracyM,
    clockInMocked: entry.clockInMocked,
    clockOutLat: entry.clockOutLat ?? null,
    clockOutLng: entry.clockOutLng ?? null,
    clockOutAccuracyM: entry.clockOutAccuracyM ?? null,
    clockOutMocked: entry.clockOutMocked ?? null,
    isOpen: entry.isOpen,
  };
}

function isAdminRole(roleName: string) {
  return roleName === "admin" || roleName === "owner" || roleName === "manager";
}

function assertWithinGeofence(
  lat: number,
  lng: number,
  accuracy: number,
  mocked: boolean,
  venue: Doc<"venues">,
) {
  if (mocked) throw new Error("Mocked locations are not allowed.");
  if (accuracy > 50)
    throw new Error("Location accuracy must be 50m or better.");
  const earthRadius = 6371000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLat = toRadians(lat - venue.latitude);
  const deltaLng = toRadians(lng - venue.longitude);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(venue.latitude)) *
      Math.cos(toRadians(lat)) *
      Math.sin(deltaLng / 2) ** 2;
  const distance = 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(a)));
  if (distance > venue.geofenceRadiusM) {
    throw new Error("You are outside the venue geofence.");
  }
}

export const bootstrapProfile = mutation({
  args: { fullName: v.optional(v.string()) },
  // Multitenant: a brand-new account has NO venue until it registers one
  // (registerVenue) or is invited as staff. venue can therefore be null.
  returns: v.object({
    profile: profileValue,
    venue: v.union(venueValue, v.null()),
  }),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx as AnyCtx);
    const userId = await getAuthUserId(ctx as AnyCtx);
    if (!userId) throw new Error("Unauthenticated");

    const existing = await getProfile(ctx as AnyCtx);
    // Only ever use the profile's OWN venue — never auto-join another tenant's.
    const venue = existing?.venueId
      ? await (ctx as AnyCtx).db.get(existing.venueId)
      : null;
    const email = identity.email ?? `${userId}@venuewrangler.local`;
    let profile = existing;

    if (!profile) {
      // New standalone account: no venue until they create one or redeem a
      // server-created invite token. Do not auto-claim roster profiles by email:
      // Password-provider emails are self-asserted until an email verification
      // provider is configured, so email alone cannot authorize venue access.
      const roleName = "staff";
      const profileId = await (ctx as AnyCtx).db.insert("profiles", {
        userId,
        tokenIdentifier: identity.tokenIdentifier,
        email,
        fullName: args.fullName?.trim() || displayName(identity),
        role: roleName,
        jobTitle: defaultJobTitle(roleName),
        venueId: undefined,
        trialEndsAt: Date.now() + TRIAL_DURATION_MS,
      });
      profile = await (ctx as AnyCtx).db.get(profileId);
    } else {
      const patch: Record<string, unknown> = {};
      if (!existing.userId) {
        patch.userId = userId;
        patch.tokenIdentifier = identity.tokenIdentifier;
      }
      // Backfill the trial for accounts created before per-user trials existed.
      if (existing.trialEndsAt == null)
        patch.trialEndsAt = Date.now() + TRIAL_DURATION_MS;
      if (Object.keys(patch).length > 0) {
        await (ctx as AnyCtx).db.patch(existing._id, patch);
        profile = await (ctx as AnyCtx).db.get(existing._id);
      }
    }

    if (!profile) throw new Error("Unable to load profile");
    return {
      profile: mapProfile(profile),
      venue: venue ? mapVenue(venue) : null,
    };
  },
});

const STAFF_RANGES = ["1-15", "16-30", "31-50"] as const;
function planForStaffRange(range: string) {
  if (range === "16-30")
    return { planId: "venueflow_growth_30_monthly", priceCents: 14999 };
  if (range === "31-50")
    return { planId: "venueflow_pro_50_monthly", priceCents: 29999 };
  return { planId: "venueflow_starter_15_monthly", priceCents: 7999 };
}

// Multitenant signup: the authenticated owner creates THEIR OWN venue. The
// business name becomes the venue's lookup key for staff PIN login.
export const registerVenue = mutation({
  args: {
    businessName: v.string(),
    ownerName: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    venueType: v.optional(v.string()),
    staffRange: v.string(),
  },
  returns: v.object({ profile: profileValue, venue: venueValue }),
  handler: async (ctx, args) => {
    await requireIdentity(ctx as AnyCtx);
    const userId = await getAuthUserId(ctx as AnyCtx);
    if (!userId) throw new Error("Unauthenticated");

    const businessName = args.businessName.trim();
    if (!businessName) throw new Error("Enter your business name");
    if (args.staffRange === "50+") {
      throw new Error(
        "For 50+ staff, please contact admin@venuewrangler.com to set up your account.",
      );
    }
    if (
      !STAFF_RANGES.includes(args.staffRange as (typeof STAFF_RANGES)[number])
    ) {
      throw new Error("Choose a staff size range");
    }

    let profile = await getProfile(ctx as AnyCtx);
    // Already has a venue → idempotent (return it).
    if (profile?.venueId) {
      const existingVenue = await (ctx as AnyCtx).db.get(profile.venueId);
      if (existingVenue)
        return { profile: mapProfile(profile), venue: mapVenue(existingVenue) };
    }

    const now = Date.now();
    const plan = planForStaffRange(args.staffRange);
    const venueId = await (ctx as AnyCtx).db.insert("venues", {
      name: businessName,
      latitude: 0,
      longitude: 0,
      geofenceRadiusM: 150,
      phone: args.phone?.trim() || undefined,
      address: args.address?.trim() || undefined,
      venueType: args.venueType?.trim() || undefined,
      staffRange: args.staffRange,
      subscriptionStatus: "trialing",
      subscriptionPlatform: null,
    });
    await (ctx as AnyCtx).db.insert("subscriptions", {
      venueId,
      status: "trialing",
      platform: null,
      planId: plan.planId,
      priceCents: plan.priceCents,
      currency: "USD",
      trialStartedAt: now,
      trialEndsAt: now + TRIAL_DURATION_MS,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      externalSubscriptionId: null,
      externalCustomerId: null,
      createdAt: now,
      updatedAt: now,
      dataRetentionWarnedAt: undefined,
    });

    const ownerName = args.ownerName?.trim();
    if (profile) {
      await (ctx as AnyCtx).db.patch(profile._id, {
        venueId,
        role: "admin",
        jobTitle: "Owner",
        ...(ownerName ? { fullName: ownerName } : {}),
      });
      profile = await (ctx as AnyCtx).db.get(profile._id);
    } else {
      const identity = await requireIdentity(ctx as AnyCtx);
      const profileId = await (ctx as AnyCtx).db.insert("profiles", {
        userId,
        tokenIdentifier: identity.tokenIdentifier,
        email: identity.email ?? `${userId}@venuewrangler.local`,
        fullName: ownerName || displayName(identity),
        role: "admin",
        jobTitle: "Owner",
        venueId,
      });
      profile = await (ctx as AnyCtx).db.get(profileId);
    }

    const venue = await (ctx as AnyCtx).db.get(venueId);
    if (!profile || !venue) throw new Error("Unable to create venue");
    return { profile: mapProfile(profile), venue: mapVenue(venue) };
  },
});

export const getMe = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({ profile: profileValue, venue: v.union(venueValue, v.null()) }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const profile = await getProfile(ctx as AnyCtx);
    // Return null ONLY when the profile genuinely doesn't exist (a deleted /
    // stale session). A profile WITHOUT a venue is still a valid logged-in
    // user — they simply haven't created or joined a venue yet — and must NOT
    // be signed out, otherwise the app bounces them back to login in a loop.
    if (!profile) return null;
    const venue = profile.venueId
      ? await (ctx as AnyCtx).db.get(profile.venueId)
      : null;
    return {
      profile: mapProfile(profile),
      venue: venue ? mapVenue(venue) : null,
    };
  },
});

export const updateVenue = mutation({
  args: {
    venueId: v.id("venues"),
    name: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    geofenceRadiusM: v.optional(v.number()),
  },
  returns: venueValue,
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (
      !profile ||
      profile.venueId !== args.venueId ||
      !isAdminRole(profile.role)
    ) {
      throw new Error("Not authorized");
    }

    const venue = await (ctx as AnyCtx).db.get(args.venueId);
    if (!venue) throw new Error("Venue not found");

    const patch: Record<string, unknown> = {};
    if (args.name !== undefined && args.name.trim())
      patch.name = args.name.trim();
    if (args.latitude !== undefined) {
      if (args.latitude < -90 || args.latitude > 90)
        throw new Error("Latitude must be between -90 and 90");
      patch.latitude = args.latitude;
    }
    if (args.longitude !== undefined) {
      if (args.longitude < -180 || args.longitude > 180)
        throw new Error("Longitude must be between -180 and 180");
      patch.longitude = args.longitude;
    }
    if (args.geofenceRadiusM !== undefined) {
      patch.geofenceRadiusM = Math.max(
        20,
        Math.min(2000, args.geofenceRadiusM),
      );
    }

    await (ctx as AnyCtx).db.patch(venue._id, patch);
    const updated = await (ctx as AnyCtx).db.get(venue._id);
    if (!updated) throw new Error("Unable to update venue");
    return mapVenue(updated);
  },
});

export const getMyVenueBilling = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      venueId: v.id("venues"),
      status: subscriptionStatusValue,
      platform: subscriptionPlatformValue,
      trialStartedAt: v.number(),
      trialEndsAt: v.number(),
      currentPeriodStart: v.union(v.number(), v.null()),
      currentPeriodEnd: v.union(v.number(), v.null()),
      cancelAtPeriodEnd: v.boolean(),
      cancelledAt: v.union(v.number(), v.null()),
      planId: v.string(),
      priceCents: v.number(),
      currency: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile?.venueId) return null;
    const subscription = await (ctx as AnyCtx).db
      .query("subscriptions")
      .withIndex("by_venue", (q: any) => q.eq("venueId", profile.venueId))
      .unique();
    if (!subscription) return null;
    return {
      venueId: subscription.venueId,
      status: subscription.status,
      platform: subscription.platform,
      trialStartedAt: subscription.trialStartedAt,
      trialEndsAt: subscription.trialEndsAt,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      cancelledAt: subscription.cancelledAt,
      planId: subscription.planId,
      priceCents: subscription.priceCents,
      currency: subscription.currency,
    };
  },
});

export const getDashboard = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      profile: profileValue,
      venue: venueValue,
      analytics: v.object({
        teamCount: v.number(),
        scheduledCount: v.number(),
        openShiftCount: v.number(),
        coveredShiftCount: v.number(),
        openClockCount: v.number(),
        clockedInCount: v.number(),
      }),
      schedule: v.array(scheduleShiftValue),
      activeClockEntries: v.array(clockEntryValue),
    }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || !profile.venueId) return null;
    const venue = await (ctx as AnyCtx).db.get(profile.venueId);
    if (!venue) return null;
    await requireActiveSubscription(ctx as any, profile.venueId);

    // Team-wide headcount, live clock-in roster, and coworker schedule names
    // are management-only. Staff receive only their own shifts plus open shifts.
    const canManage = isAdminRole(profile.role);
    const shifts = await (ctx as AnyCtx).db
      .query("scheduleShifts")
      .withIndex("by_venueId", (q: any) => q.eq("venueId", venue._id))
      .take(500);
    const visibleShifts = canManage
      ? shifts
      : shifts.filter(
          (shift: Doc<"scheduleShifts">) =>
            shift.profileId === profile._id || shift.status === "open",
        );
    const entries = canManage
      ? await (ctx as AnyCtx).db
          .query("timeEntries")
          .withIndex("by_venueId", (q: any) => q.eq("venueId", venue._id))
          .take(500)
      : [];
    const team = canManage
      ? await (ctx as AnyCtx).db
          .query("profiles")
          .withIndex("by_venueId", (q: any) => q.eq("venueId", venue._id))
          .take(200)
      : [];

    const activeEntries: Array<{
      entry: Doc<"timeEntries">;
      profile: Doc<"profiles">;
      venue: Doc<"venues">;
    }> = [];
    for (const entry of entries) {
      if (!entry.isOpen) continue;
      const entryProfile = await (ctx as AnyCtx).db.get(entry.profileId);
      if (!entryProfile) continue;
      activeEntries.push({ entry, profile: entryProfile, venue });
    }

    const schedule: Array<ReturnType<typeof mapShift>> = [];
    for (const shift of visibleShifts.slice(0, 14)) {
      const shiftProfile =
        canManage && shift.profileId
          ? await (ctx as AnyCtx).db.get(shift.profileId)
          : null;
      const profileName = canManage
        ? (shiftProfile?.fullName ?? null)
        : shift.profileId === profile._id
          ? "You"
          : null;
      schedule.push(mapShift(shift, profileName));
    }

    return {
      profile: mapProfile(profile),
      venue: mapVenue(venue),
      analytics: {
        teamCount: canManage ? team.length : 0,
        scheduledCount: visibleShifts.filter(
          (item: Doc<"scheduleShifts">) => item.status === "scheduled",
        ).length,
        openShiftCount: visibleShifts.filter(
          (item: Doc<"scheduleShifts">) => item.status === "open",
        ).length,
        coveredShiftCount: visibleShifts.filter(
          (item: Doc<"scheduleShifts">) => item.status === "covered",
        ).length,
        openClockCount: canManage
          ? entries.filter((item: Doc<"timeEntries">) => item.isOpen).length
          : 0,
        clockedInCount: canManage ? activeEntries.length : 0,
      },
      schedule,
      activeClockEntries: canManage
        ? activeEntries.map(
            ({ entry, profile: entryProfile, venue: entryVenue }) =>
              mapClockEntry(entry, entryProfile, entryVenue),
          )
        : [],
    };
  },
});

export const getWeeklySchedule = query({
  args: {},
  returns: v.union(v.null(), v.array(scheduleShiftValue)),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || !profile.venueId) return null;
    const shifts = await (ctx as AnyCtx).db
      .query("scheduleShifts")
      .withIndex("by_venueId", (q: any) => q.eq("venueId", profile.venueId))
      .take(500);
    const mapped: Array<ReturnType<typeof mapShift>> = [];
    for (const shift of shifts) {
      const shiftProfile = shift.profileId
        ? await (ctx as AnyCtx).db.get(shift.profileId)
        : null;
      mapped.push(mapShift(shift, shiftProfile?.fullName ?? null));
    }
    return mapped;
  },
});

export const getClockBoard = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      venue: venueValue,
      activeClockEntries: v.array(clockEntryValue),
      employeeEntry: v.union(clockEntryValue, v.null()),
      managerAlerts: v.array(managerAlertValue),
    }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || !profile.venueId) return null;
    const venue = await (ctx as AnyCtx).db.get(profile.venueId);
    if (!venue) return null;
    const entries = await (ctx as AnyCtx).db
      .query("timeEntries")
      .withIndex("by_venueId", (q: any) => q.eq("venueId", venue._id))
      .take(500);
    const openEntries: Array<ReturnType<typeof mapClockEntry>> = [];
    for (const entry of entries) {
      if (!entry.isOpen) continue;
      const entryProfile = await (ctx as AnyCtx).db.get(entry.profileId);
      if (!entryProfile) continue;
      openEntries.push(mapClockEntry(entry, entryProfile, venue));
    }
    const myOpenEntry =
      openEntries.find(
        (item: ReturnType<typeof mapClockEntry>) =>
          item.memberId === profile._id,
      ) ?? null;
    const managerAlerts: Array<{
      kind: "late_clock_in" | "missed_clock_out";
      severity: "warning" | "danger";
      profileId: Id<"profiles">;
      memberName: string;
      detail: string;
    }> = [];
    if (isAdminRole(profile.role)) {
      const now = Date.now();
      const today = new Date().getDay();
      const minutesNow = new Date().getHours() * 60 + new Date().getMinutes();
      const openByProfile = new Set(
        entries
          .filter((entry: Doc<"timeEntries">) => entry.isOpen)
          .map((entry: Doc<"timeEntries">) => entry.profileId),
      );
      const shifts = await (ctx as AnyCtx).db
        .query("scheduleShifts")
        .withIndex("by_venueId", (q: any) => q.eq("venueId", venue._id))
        .take(500);
      for (const shift of shifts) {
        if (
          shift.dayIndex !== today ||
          !shift.profileId ||
          shift.status === "open"
        )
          continue;
        if (
          minutesNow >= shift.startMinutes + 15 &&
          minutesNow <= shift.endMinutes &&
          !openByProfile.has(shift.profileId)
        ) {
          const staff = await (ctx as AnyCtx).db.get(shift.profileId);
          if (staff) {
            managerAlerts.push({
              kind: "late_clock_in",
              severity: "warning",
              profileId: staff._id,
              memberName: staff.fullName,
              detail: `${shift.jobTitle} was scheduled at ${minutesToTime(shift.startMinutes)} and is not clocked in.`,
            });
          }
        }
      }
      for (const entry of entries) {
        if (!entry.isOpen || now - entry.clockInAt < 10 * 60 * 60 * 1000)
          continue;
        const staff = await (ctx as AnyCtx).db.get(entry.profileId);
        if (staff) {
          managerAlerts.push({
            kind: "missed_clock_out",
            severity: "danger",
            profileId: staff._id,
            memberName: staff.fullName,
            detail: `Clocked in since ${new Date(entry.clockInAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`,
          });
        }
      }
    }
    return {
      venue: mapVenue(venue),
      activeClockEntries: openEntries,
      employeeEntry: myOpenEntry,
      managerAlerts: managerAlerts.slice(0, 8),
    };
  },
});

export const getMyTimeClock = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      isClockedIn: v.boolean(),
      openSince: v.union(v.number(), v.null()),
      regularHours: v.number(),
      sickHours: v.number(),
      totalHours: v.number(),
      punches: v.array(
        v.object({
          type: v.union(v.literal("in"), v.literal("out")),
          at: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile) return null;
    const open = await (ctx as AnyCtx).db
      .query("timeEntries")
      .withIndex("by_profileId_and_isOpen", (q: any) =>
        q.eq("profileId", profile._id).eq("isOpen", true),
      )
      .take(5);
    const closed = await (ctx as AnyCtx).db
      .query("timeEntries")
      .withIndex("by_profileId_and_isOpen", (q: any) =>
        q.eq("profileId", profile._id).eq("isOpen", false),
      )
      .take(100);
    const all = [...open, ...closed] as Doc<"timeEntries">[];

    const startOfToday = new Date().setHours(0, 0, 0, 0);
    const now = Date.now();
    const punches: { type: "in" | "out"; at: number }[] = [];
    for (const e of all) {
      if (e.clockInAt >= startOfToday)
        punches.push({ type: "in", at: e.clockInAt });
      if (e.clockOutAt && e.clockOutAt >= startOfToday)
        punches.push({ type: "out", at: e.clockOutAt });
    }
    punches.sort((a, b) => a.at - b.at);

    const weekMs = 1000 * 60 * 60 * 24 * 7;
    const regularHours = closed.reduce((sum: number, e: Doc<"timeEntries">) => {
      if (!e.clockOutAt || now - e.clockOutAt > weekMs) return sum;
      return sum + (e.clockOutAt - e.clockInAt) / 3600000;
    }, 0);
    const round1 = (n: number) => Math.round(n * 10) / 10;

    return {
      isClockedIn: open.length > 0,
      openSince: open[0]?.clockInAt ?? null,
      regularHours: round1(regularHours),
      sickHours: 0,
      totalHours: round1(regularHours),
      punches,
    };
  },
});

export const clockIn = mutation({
  args: {
    lat: v.number(),
    lng: v.number(),
    accuracy: v.number(),
    mocked: v.boolean(),
  },
  returns: clockEntryValue,
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx as AnyCtx);
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || !profile.venueId)
      throw new Error("Profile is not initialized");

    await requireActiveSubscription(ctx as any, profile.venueId);
    const venue = await (ctx as AnyCtx).db.get(profile.venueId);
    if (!venue) throw new Error("Assigned venue not found");
    assertWithinGeofence(args.lat, args.lng, args.accuracy, args.mocked, venue);
    const activeEntry = await (ctx as AnyCtx).db
      .query("timeEntries")
      .withIndex("by_profileId_and_isOpen", (q: any) =>
        q.eq("profileId", profile._id).eq("isOpen", true),
      )
      .unique();
    if (activeEntry) throw new Error("Already clocked in");
    const entryId = await (ctx as AnyCtx).db.insert("timeEntries", {
      profileId: profile._id,
      venueId: venue._id,
      clockInAt: Date.now(),
      clockOutAt: undefined,
      clockInLat: args.lat,
      clockInLng: args.lng,
      clockInAccuracyM: args.accuracy,
      clockInMocked: args.mocked,
      clockOutLat: undefined,
      clockOutLng: undefined,
      clockOutAccuracyM: undefined,
      clockOutMocked: undefined,
      isOpen: true,
    });
    const entry = await (ctx as AnyCtx).db.get(entryId);
    if (!entry) throw new Error("Unable to create time entry");
    return mapClockEntry(entry, profile, venue);
  },
});

export const clockOut = mutation({
  args: {
    lat: v.number(),
    lng: v.number(),
    accuracy: v.number(),
    mocked: v.boolean(),
  },
  returns: clockEntryValue,
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx as AnyCtx);
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || !profile.venueId)
      throw new Error("Profile is not initialized");

    await requireActiveSubscription(ctx as any, profile.venueId);
    const venue = await (ctx as AnyCtx).db.get(profile.venueId);
    if (!venue) throw new Error("Assigned venue not found");
    assertWithinGeofence(args.lat, args.lng, args.accuracy, args.mocked, venue);
    const activeEntry = await (ctx as AnyCtx).db
      .query("timeEntries")
      .withIndex("by_profileId_and_isOpen", (q: any) =>
        q.eq("profileId", profile._id).eq("isOpen", true),
      )
      .unique();
    if (!activeEntry) throw new Error("No active clock-in found");
    await (ctx as AnyCtx).db.patch(activeEntry._id, {
      clockOutAt: Date.now(),
      clockOutLat: args.lat,
      clockOutLng: args.lng,
      clockOutAccuracyM: args.accuracy,
      clockOutMocked: args.mocked,
      isOpen: false,
    });
    const entry = await (ctx as AnyCtx).db.get(activeEntry._id);
    if (!entry) throw new Error("Unable to update time entry");
    return mapClockEntry(entry, profile, venue);
  },
});

export const getAdminAnalytics = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      profile: profileValue,
      venue: venueValue,
      analytics: v.object({
        totalShifts: v.number(),
        openShifts: v.number(),
        activeClocks: v.number(),
      }),
    }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || !profile.venueId || !isAdminRole(profile.role)) return null;
    const venue = await (ctx as AnyCtx).db.get(profile.venueId);
    if (!venue) return null;
    const shifts = await (ctx as AnyCtx).db
      .query("scheduleShifts")
      .withIndex("by_venueId", (q: any) => q.eq("venueId", venue._id))
      .take(500);
    const entries = await (ctx as AnyCtx).db
      .query("timeEntries")
      .withIndex("by_venueId", (q: any) => q.eq("venueId", venue._id))
      .take(500);
    return {
      profile: mapProfile(profile),
      venue: mapVenue(venue),
      analytics: {
        totalShifts: shifts.length,
        openShifts: shifts.filter(
          (item: Doc<"scheduleShifts">) => item.status === "open",
        ).length,
        activeClocks: entries.filter((item: Doc<"timeEntries">) => item.isOpen)
          .length,
      },
    };
  },
});

export const listStaffRequests = query({
  args: { venueId: v.id("venues") },
  returns: v.array(staffRequestValue),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId) return [];
    await requireActiveSubscription(ctx as any, args.venueId);
    const requests = await (ctx as AnyCtx).db
      .query("staffRequests")
      .withIndex("by_venueId", (q: any) => q.eq("venueId", args.venueId))
      .take(300);
    return requests.map((request: Doc<"staffRequests">) => ({
      _id: request._id,
      _creationTime: request._creationTime,
      venueId: request.venueId,
      profileId: request.profileId,
      kind: request.kind,
      status: request.status,
      title: request.title,
      details: request.details,
      requestedForDate: request.requestedForDate ?? null,
      requestedShiftId: request.requestedShiftId ?? null,
      requestedRangeStart: request.requestedRangeStart ?? null,
      requestedRangeEnd: request.requestedRangeEnd ?? null,
      availability: request.availability ?? null,
      reviewerId: request.reviewerId ?? null,
      reviewedAt: request.reviewedAt ?? null,
      responseNotes: request.responseNotes ?? null,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    }));
  },
});

export const createStaffRequest = mutation({
  args: {
    venueId: v.id("venues"),
    kind: requestKind,
    title: v.string(),
    details: v.string(),
    requestedForDate: v.optional(v.string()),
    requestedShiftId: v.optional(v.id("scheduleShifts")),
    requestedRangeStart: v.optional(v.string()),
    requestedRangeEnd: v.optional(v.string()),
    availability: v.optional(
      v.array(
        v.object({
          dayIndex: v.number(),
          startMinutes: v.number(),
          endMinutes: v.number(),
          available: v.boolean(),
        }),
      ),
    ),
  },
  returns: staffRequestValue,
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx as AnyCtx);
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId)
      throw new Error("Profile does not belong to this venue");

    await requireActiveSubscription(ctx as any, args.venueId);

    // Block time-off requests that overlap a manager-defined blackout window.
    if (args.kind === "time_off") {
      const reqStart = args.requestedRangeStart || args.requestedForDate;
      const reqEnd =
        args.requestedRangeEnd || args.requestedForDate || reqStart;
      if (reqStart && reqEnd) {
        const blackouts = await (ctx as AnyCtx).db
          .query("blackoutDates")
          .withIndex("by_venue", (q: any) => q.eq("venueId", args.venueId))
          .take(100);
        const hit = blackouts.find(
          (b: Doc<"blackoutDates">) =>
            reqStart <= b.endDate && b.startDate <= reqEnd,
        );
        if (hit) {
          throw new Error(
            `Time off is blacked out ${hit.startDate}${hit.endDate !== hit.startDate ? ` – ${hit.endDate}` : ""} (${hit.reason}). Please choose other dates.`,
          );
        }
      }
    }

    const now = Date.now();
    const requestId = await (ctx as AnyCtx).db.insert("staffRequests", {
      venueId: args.venueId,
      profileId: profile._id,
      kind: args.kind,
      status: "pending",
      title: args.title,
      details: args.details,
      requestedForDate: args.requestedForDate,
      requestedShiftId: args.requestedShiftId,
      requestedRangeStart: args.requestedRangeStart,
      requestedRangeEnd: args.requestedRangeEnd,
      availability: args.availability,
      reviewerId: undefined,
      reviewedAt: undefined,
      responseNotes: undefined,
      createdAt: now,
      updatedAt: now,
    });
    await notifyManagers(ctx as AnyCtx, {
      venueId: args.venueId,
      kind: "request_created",
      title: "New staff request",
      body: `${profile.fullName} submitted ${args.kind.replace("_", " ")}: ${args.title}`,
    });
    const request = await (ctx as AnyCtx).db.get(requestId);
    if (!request) throw new Error("Unable to create request");
    return {
      _id: request._id,
      _creationTime: request._creationTime,
      venueId: request.venueId,
      profileId: request.profileId,
      kind: request.kind,
      status: request.status,
      title: request.title,
      details: request.details,
      requestedForDate: request.requestedForDate ?? null,
      requestedShiftId: request.requestedShiftId ?? null,
      requestedRangeStart: request.requestedRangeStart ?? null,
      requestedRangeEnd: request.requestedRangeEnd ?? null,
      availability: request.availability ?? null,
      reviewerId: request.reviewerId ?? null,
      reviewedAt: request.reviewedAt ?? null,
      responseNotes: request.responseNotes ?? null,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  },
});

export const reviewStaffRequest = mutation({
  args: {
    requestId: v.id("staffRequests"),
    status: requestStatus,
    responseNotes: v.optional(v.string()),
  },
  returns: staffRequestValue,
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx as AnyCtx);
    const reviewer = await getProfile(ctx as AnyCtx);
    if (
      !reviewer ||
      !reviewer.venueId ||
      !(
        reviewer.role === "admin" ||
        reviewer.role === "owner" ||
        reviewer.role === "manager"
      )
    ) {
      throw new Error("Not authorized");
    }

    await requireActiveSubscription(ctx as any, reviewer.venueId);
    const request = await (ctx as AnyCtx).db.get(args.requestId);
    if (!request) throw new Error("Request not found");
    if (request.venueId !== reviewer.venueId)
      throw new Error("Request does not belong to this venue");
    await (ctx as AnyCtx).db.patch(request._id, {
      status: args.status,
      reviewerId: reviewer._id,
      reviewedAt: Date.now(),
      responseNotes: args.responseNotes,
      updatedAt: Date.now(),
    });
    await notifyProfile(ctx as AnyCtx, {
      venueId: reviewer.venueId,
      profileId: request.profileId,
      kind: "request_reviewed",
      title: `Request ${args.status}`,
      body:
        args.responseNotes?.trim() ||
        `${reviewer.fullName} marked your ${request.kind.replace("_", " ")} request ${args.status}.`,
    });
    const updated = await (ctx as AnyCtx).db.get(request._id);
    if (!updated) throw new Error("Unable to update request");
    return {
      _id: updated._id,
      _creationTime: updated._creationTime,
      venueId: updated.venueId,
      profileId: updated.profileId,
      kind: updated.kind,
      status: updated.status,
      title: updated.title,
      details: updated.details,
      requestedForDate: updated.requestedForDate ?? null,
      requestedShiftId: updated.requestedShiftId ?? null,
      requestedRangeStart: updated.requestedRangeStart ?? null,
      requestedRangeEnd: updated.requestedRangeEnd ?? null,
      availability: updated.availability ?? null,
      reviewerId: updated.reviewerId ?? null,
      reviewedAt: updated.reviewedAt ?? null,
      responseNotes: updated.responseNotes ?? null,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  },
});

export const getMyHoursAndRequests = query({
  args: { venueId: v.id("venues") },
  returns: v.union(
    v.null(),
    v.object({
      hoursWorked: v.number(),
      hoursThisWeek: v.number(),
      requests: v.array(staffRequestValue),
      openShifts: v.array(scheduleShiftValue),
    }),
  ),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId) return null;
    await requireActiveSubscription(ctx as any, args.venueId);
    const entries = await (ctx as AnyCtx).db
      .query("timeEntries")
      .withIndex("by_profileId_and_isOpen", (q: any) =>
        q.eq("profileId", profile._id).eq("isOpen", false),
      )
      .take(300);
    const requests = await (ctx as AnyCtx).db
      .query("staffRequests")
      .withIndex("by_profileId", (q: any) => q.eq("profileId", profile._id))
      .take(300);
    const shifts = await (ctx as AnyCtx).db
      .query("scheduleShifts")
      .withIndex("by_profileId", (q: any) => q.eq("profileId", profile._id))
      .take(500);
    const now = Date.now();
    const hoursWorked = entries.reduce(
      (sum: number, entry: Doc<"timeEntries">) => {
        if (!entry.clockOutAt) return sum;
        return sum + (entry.clockOutAt - entry.clockInAt) / 3600000;
      },
      0,
    );
    const hoursThisWeek = entries.reduce(
      (sum: number, entry: Doc<"timeEntries">) => {
        if (!entry.clockOutAt) return sum;
        if (now - entry.clockOutAt > 1000 * 60 * 60 * 24 * 7) return sum;
        return sum + (entry.clockOutAt - entry.clockInAt) / 3600000;
      },
      0,
    );
    return {
      hoursWorked: Math.round(hoursWorked * 10) / 10,
      hoursThisWeek: Math.round(hoursThisWeek * 10) / 10,
      requests: requests.map((request: Doc<"staffRequests">) => ({
        _id: request._id,
        _creationTime: request._creationTime,
        venueId: request.venueId,
        profileId: request.profileId,
        kind: request.kind,
        status: request.status,
        title: request.title,
        details: request.details,
        requestedForDate: request.requestedForDate ?? null,
        requestedShiftId: request.requestedShiftId ?? null,
        requestedRangeStart: request.requestedRangeStart ?? null,
        requestedRangeEnd: request.requestedRangeEnd ?? null,
        availability: request.availability ?? null,
        reviewerId: request.reviewerId ?? null,
        reviewedAt: request.reviewedAt ?? null,
        responseNotes: request.responseNotes ?? null,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
      })),
      openShifts: shifts.map((shift: Doc<"scheduleShifts">) => ({
        _id: shift._id,
        _creationTime: shift._creationTime,
        venueId: shift.venueId,
        profileId: shift.profileId ?? null,
        dayIndex: shift.dayIndex,
        startMinutes: shift.startMinutes,
        endMinutes: shift.endMinutes,
        jobTitle: shift.jobTitle,
        station: shift.station,
        notes: shift.notes ?? null,
        status: shift.status,
        dayLabel: dayLabel(shift.dayIndex),
        memberName: profile.fullName,
        startTime: minutesToTime(shift.startMinutes),
        endTime: minutesToTime(shift.endMinutes),
      })),
    };
  },
});

const staffProfileValue = profileValue;

export const listVenueStaff = query({
  args: { venueId: v.id("venues") },
  returns: v.array(staffProfileValue),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const viewer = await getProfile(ctx as AnyCtx);
    if (!viewer || viewer.venueId !== args.venueId || !isAdminRole(viewer.role))
      return [];
    const staff = await (ctx as AnyCtx).db
      .query("profiles")
      .withIndex("by_venueId", (q: any) => q.eq("venueId", args.venueId))
      .take(200);
    return staff
      .filter((member: Doc<"profiles">) => member.venueId === args.venueId)
      .sort((a: Doc<"profiles">, b: Doc<"profiles">) =>
        a.fullName.localeCompare(b.fullName),
      )
      .map(mapProfile);
  },
});

export const upsertVenueStaff = mutation({
  args: {
    venueId: v.id("venues"),
    email: v.string(),
    fullName: v.string(),
    role,
    jobTitle: v.string(),
  },
  returns: staffProfileValue,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const viewer = await getProfile(ctx as AnyCtx);
    if (!viewer || viewer.venueId !== args.venueId || !isAdminRole(viewer.role))
      throw new Error("Not authorized");

    const existing = await (ctx as AnyCtx).db
      .query("profiles")
      .withIndex("by_venueId", (q: any) => q.eq("venueId", args.venueId))
      .take(200);
    const member =
      existing.find(
        (item: Doc<"profiles">) =>
          item.email.toLowerCase() === args.email.toLowerCase(),
      ) ?? null;
    const now = Date.now();

    if (member) {
      await (ctx as AnyCtx).db.patch(member._id, {
        email: args.email,
        fullName: args.fullName,
        role: args.role,
        jobTitle: args.jobTitle,
        venueId: args.venueId,
      });
      const updated = await (ctx as AnyCtx).db.get(member._id);
      if (!updated) throw new Error("Unable to update staff member");
      return mapProfile(updated);
    }

    const profileId = await (ctx as AnyCtx).db.insert("profiles", {
      tokenIdentifier: `${args.email.toLowerCase()}:invited:${now}`,
      email: args.email.toLowerCase(),
      fullName: args.fullName,
      role: args.role,
      jobTitle: args.jobTitle,
      venueId: args.venueId,
    });
    const created = await (ctx as AnyCtx).db.get(profileId);
    if (!created) throw new Error("Unable to create staff member");
    return mapProfile(created);
  },
});

export const deactivateVenueStaff = mutation({
  args: { staffId: v.id("profiles") },
  returns: profileValue,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const viewer = await getProfile(ctx as AnyCtx);
    if (!viewer || !viewer.venueId || !isAdminRole(viewer.role))
      throw new Error("Not authorized");

    const staff = await (ctx as AnyCtx).db.get(args.staffId);
    if (!staff) throw new Error("Staff member not found");
    if (staff.venueId !== viewer.venueId)
      throw new Error("Staff member does not belong to this venue");
    await (ctx as AnyCtx).db.patch(staff._id, { venueId: undefined });
    const updated = await (ctx as AnyCtx).db.get(staff._id);
    if (!updated) throw new Error("Unable to deactivate staff member");
    return mapProfile(updated);
  },
});

export const getNotifications = query({
  args: {},
  returns: v.array(notificationEventValue),
  handler: async (ctx) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile?.venueId) return [];
    const rows = await (ctx as AnyCtx).db
      .query("notificationEvents")
      .withIndex("by_venue_and_createdAt", (q: any) =>
        q.eq("venueId", profile.venueId),
      )
      .order("desc")
      .take(20);
    const visible = rows
      .filter(
        (row: Doc<"notificationEvents">) =>
          row.audience !== "profile" || row.profileId === profile._id,
      )
      .filter(
        (row: Doc<"notificationEvents">) =>
          row.audience !== "managers" || isAdminRole(profile.role),
      );
    return await Promise.all(
      visible.map(async (row: Doc<"notificationEvents">) => {
        const receipt = await (ctx as AnyCtx).db
          .query("notificationReads")
          .withIndex("by_notification_and_profile", (q: any) =>
            q.eq("notificationId", row._id).eq("profileId", profile._id),
          )
          .unique();
        return {
          _id: row._id,
          kind: row.kind,
          title: row.title,
          body: row.body,
          createdAt: row.createdAt,
          read:
            Boolean(receipt) ||
            (row.readBy ?? []).some((id) => id === profile._id),
        };
      }),
    );
  },
});

export const markNotificationRead = mutation({
  args: { notificationId: v.id("notificationEvents") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile?.venueId) throw new Error("Profile is not initialized");

    const row = await (ctx as AnyCtx).db.get(args.notificationId);
    if (!row || row.venueId !== profile.venueId)
      throw new Error("Notification not found");
    const canRead =
      row.audience === "staff" ||
      (row.audience === "managers" && isAdminRole(profile.role)) ||
      row.profileId === profile._id;
    if (!canRead) throw new Error("Not authorized");
    const existing = await (ctx as AnyCtx).db
      .query("notificationReads")
      .withIndex("by_notification_and_profile", (q: any) =>
        q.eq("notificationId", row._id).eq("profileId", profile._id),
      )
      .unique();
    if (!existing) {
      await (ctx as AnyCtx).db.insert("notificationReads", {
        notificationId: row._id,
        profileId: profile._id,
        venueId: profile.venueId,
        readAt: Date.now(),
      });
    }
    return null;
  },
});

export const getManagerInsights = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      scheduledShifts: v.number(),
      openShifts: v.number(),
      activeClocks: v.number(),
      lateOrMissedAlerts: v.number(),
      activeReservations: v.number(),
      upcomingReservations: v.number(),
      pendingRequests: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile?.venueId || !isAdminRole(profile.role)) return null;
    const now = Date.now();
    const upcomingEnd = now + 24 * 60 * 60 * 1000;
    // Bounded reads: these power dashboard counters, not exhaustive lists, so a
    // generous cap keeps the query within Convex limits as the venue scales.
    const INSIGHTS_CAP = 2000;
    const shifts = await (ctx as AnyCtx).db
      .query("scheduleShifts")
      .withIndex("by_venueId", (q: any) => q.eq("venueId", profile.venueId))
      .take(INSIGHTS_CAP);
    const entries = await (ctx as AnyCtx).db
      .query("timeEntries")
      .withIndex("by_venueId", (q: any) => q.eq("venueId", profile.venueId))
      .order("desc")
      .take(INSIGHTS_CAP);
    const reservations = await (ctx as AnyCtx).db
      .query("reservations")
      .withIndex("by_venue_time", (q: any) => q.eq("venueId", profile.venueId))
      .order("desc")
      .take(INSIGHTS_CAP);
    const requests = await (ctx as AnyCtx).db
      .query("staffRequests")
      .withIndex("by_venueId", (q: any) => q.eq("venueId", profile.venueId))
      .take(INSIGHTS_CAP);
    const activeClocks = entries.filter(
      (entry: Doc<"timeEntries">) => entry.isOpen,
    );
    return {
      scheduledShifts: shifts.filter(
        (shift: Doc<"scheduleShifts">) =>
          shift.status === "scheduled" || shift.status === "covered",
      ).length,
      openShifts: shifts.filter(
        (shift: Doc<"scheduleShifts">) => shift.status === "open",
      ).length,
      activeClocks: activeClocks.length,
      lateOrMissedAlerts: activeClocks.filter(
        (entry: Doc<"timeEntries">) =>
          now - entry.clockInAt >= 10 * 60 * 60 * 1000,
      ).length,
      activeReservations: reservations.filter(
        (reservation: Doc<"reservations">) =>
          reservation.status === "confirmed" ||
          reservation.status === "checked_in" ||
          reservation.status === "seated",
      ).length,
      upcomingReservations: reservations.filter(
        (reservation: Doc<"reservations">) =>
          reservation.reservationTime >= now &&
          reservation.reservationTime <= upcomingEnd &&
          reservation.status !== "cancelled",
      ).length,
      pendingRequests: requests.filter(
        (request: Doc<"staffRequests">) => request.status === "pending",
      ).length,
    };
  },
});

export const deleteMyAccount = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx as AnyCtx);
    if (!userId) throw new Error("Unauthenticated");
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile) throw new Error("Profile not found");

    // Release assigned shifts back to open
    const shifts = await (ctx as AnyCtx).db
      .query("scheduleShifts")
      .withIndex("by_profileId", (q: any) => q.eq("profileId", profile._id))
      .take(100);
    for (const shift of shifts) {
      await (ctx as AnyCtx).db.patch(shift._id, {
        profileId: undefined,
        status: "open" as const,
      });
    }

    // Delete push tokens
    const tokens = await (ctx as AnyCtx).db
      .query("pushTokens")
      .withIndex("by_profile", (q: any) => q.eq("profileId", profile._id))
      .take(100);
    for (const token of tokens) {
      await (ctx as AnyCtx).db.delete(token._id);
    }

    // Delete availability entries
    const avail = await (ctx as AnyCtx).db
      .query("availability")
      .withIndex("by_profile", (q: any) => q.eq("profileId", profile._id))
      .take(100);
    for (const a of avail) {
      await (ctx as AnyCtx).db.delete(a._id);
    }

    await (ctx as AnyCtx).db.delete(profile._id);
    return null;
  },
});

export const exportTimeEntriesCsv = query({
  args: {},
  returns: v.union(v.null(), v.string()),
  handler: async (ctx) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile?.venueId || !isAdminRole(profile.role)) return null;
    await requireActiveSubscription(ctx as any, profile.venueId);
    const entries = await (ctx as AnyCtx).db
      .query("timeEntries")
      .withIndex("by_venue_clockInAt", (q: any) =>
        q.eq("venueId", profile.venueId),
      )
      .order("desc")
      .take(500);
    const rows = [
      [
        "member",
        "jobTitle",
        "clockInAt",
        "clockOutAt",
        "hours",
        "clockInAccuracyM",
        "clockInMocked",
      ],
    ];
    for (const entry of entries) {
      const staff = await (ctx as AnyCtx).db.get(entry.profileId);
      const hours = entry.clockOutAt
        ? Math.round(((entry.clockOutAt - entry.clockInAt) / 3600000) * 100) /
          100
        : "";
      rows.push([
        staff?.fullName ?? "Unknown",
        staff?.jobTitle ?? "",
        new Date(entry.clockInAt).toISOString(),
        entry.clockOutAt ? new Date(entry.clockOutAt).toISOString() : "",
        String(hours),
        String(entry.clockInAccuracyM),
        String(entry.clockInMocked),
      ]);
    }
    return rows.map((row) => row.map(csvCell).join(",")).join("\n");
  },
});
