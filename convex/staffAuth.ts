import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { createAccount, modifyAccountCredentials } from '@convex-dev/auth/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireVenueManager, requireVenueMember } from './authz';

const accessRoleValue = v.union(v.literal('manager'), v.literal('staff'));
const PIN_LOCK_WINDOW_MS = 15 * 60 * 1000;
const PIN_MAX_FAILURES = 5;

function randomCode(len = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

async function hashPin(venueId: Id<'venues'>, loginHandle: string, pin: string) {
  const bytes = new TextEncoder().encode(`${venueId}:${loginHandle}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function recentPinFailures(ctx: any, profileId: Id<'profiles'>) {
  const cutoff = Date.now() - PIN_LOCK_WINDOW_MS;
  const attempts = await ctx.db
    .query('pinLoginAttempts')
    .withIndex('by_profile_and_createdAt', (q: any) => q.eq('profileId', profileId))
    .order('desc')
    .take(PIN_MAX_FAILURES);
  return attempts.filter((attempt: Doc<'pinLoginAttempts'>) => !attempt.success && attempt.createdAt >= cutoff).length;
}

async function recordPinAttempt(ctx: any, venueId: Id<'venues'>, profileId: Id<'profiles'>, success: boolean) {
  await ctx.db.insert('pinLoginAttempts', {
    venueId,
    profileId,
    success,
    createdAt: Date.now(),
  });
}

// ---------- Custom roles / positions ----------

export const listVenueRoles = query({
  args: { venueId: v.id('venues') },
  returns: v.array(v.object({ _id: v.id('venueRoles'), name: v.string() })),
  handler: async (ctx, args) => {
    await requireVenueMember(ctx, args.venueId);
    const rows = await ctx.db.query('venueRoles').withIndex('by_venue', (q: any) => q.eq('venueId', args.venueId)).collect();
    return rows
      .sort((a: Doc<'venueRoles'>, b: Doc<'venueRoles'>) => a.name.localeCompare(b.name))
      .map((r: Doc<'venueRoles'>) => ({ _id: r._id, name: r.name }));
  },
});

export const addVenueRole = mutation({
  args: { venueId: v.id('venues'), name: v.string() },
  returns: v.id('venueRoles'),
  handler: async (ctx, args) => {
    await requireVenueManager(ctx, args.venueId);
    const name = args.name.trim();
    if (!name) throw new Error('Enter a role name');
    const existing = await ctx.db.query('venueRoles').withIndex('by_venue', (q: any) => q.eq('venueId', args.venueId)).collect();
    if (existing.some((r: Doc<'venueRoles'>) => r.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('That role already exists');
    }
    return await ctx.db.insert('venueRoles', { venueId: args.venueId, name });
  },
});

export const removeVenueRole = mutation({
  args: { venueId: v.id('venues'), roleId: v.id('venueRoles') },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireVenueManager(ctx, args.venueId);
    const row = await ctx.db.get(args.roleId);
    if (!row || row.venueId !== args.venueId) throw new Error('Role not found');
    await ctx.db.delete(row._id);
    return null;
  },
});

// ---------- Venue join code ----------

export const ensureVenueCode = mutation({
  args: { venueId: v.id('venues') },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireVenueManager(ctx, args.venueId);
    const venue = await ctx.db.get(args.venueId);
    if (!venue) throw new Error('Venue not found');
    if (venue.code) return venue.code;
    // ensure uniqueness
    let code = randomCode();
    for (let i = 0; i < 5; i++) {
      const clash = await ctx.db.query('venues').withIndex('by_code', (q: any) => q.eq('code', code)).first();
      if (!clash) break;
      code = randomCode();
    }
    await ctx.db.patch(venue._id, { code });
    return code;
  },
});

// ---------- Invite PIN staff ----------

export const inviteStaff = mutation({
  args: {
    venueId: v.id('venues'),
    fullName: v.string(),
    accessRole: accessRoleValue,
    jobTitle: v.string(),
    pin: v.string(),
  },
  returns: v.object({ loginHandle: v.string() }),
  handler: async (ctx, args) => {
    await requireVenueManager(ctx, args.venueId);
    const fullName = args.fullName.trim();
    if (!fullName) throw new Error('Enter a name');
    if (!/^\d{4}$/.test(args.pin)) throw new Error('PIN must be exactly 4 digits');

    const handle = `pin_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}@pin.venueflow`;
    const pinHash = await hashPin(args.venueId, handle, args.pin);

    // Provision a Convex Auth password account so the staff member can sign in
    // with their PIN as the password.
    const created = await createAccount(ctx as any, {
      provider: 'password',
      account: { id: handle, secret: args.pin },
      profile: { email: handle },
    });

    await ctx.db.insert('profiles', {
      userId: created.user._id as Id<'users'>,
      email: handle,
      fullName,
      role: args.accessRole,
      jobTitle: args.jobTitle.trim() || 'Team Member',
      venueId: args.venueId,
      isPinUser: true,
      loginHandle: handle,
      pinHash,
    });

    return { loginHandle: handle };
  },
});

// ---------- Public roster for PIN login ----------
// No auth required: staff entering a venue code see names to pick. The private
// auth handle is exchanged only after a rate-limited PIN check below.

export const getVenueRoster = query({
  args: { code: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      venueName: v.string(),
      staff: v.array(v.object({ profileId: v.id('profiles'), fullName: v.string(), jobTitle: v.string() })),
    }),
  ),
  handler: async (ctx, args) => {
    const code = args.code.trim().toUpperCase();
    if (!code) return null;
    const venue = await ctx.db.query('venues').withIndex('by_code', (q: any) => q.eq('code', code)).first();
    if (!venue) return null;
    const profiles = await ctx.db.query('profiles').withIndex('by_venueId', (q: any) => q.eq('venueId', venue._id)).collect();
    return {
      venueName: venue.name,
      staff: profiles
        .filter((p: Doc<'profiles'>) => p.isPinUser && p.loginHandle)
        .sort((a: Doc<'profiles'>, b: Doc<'profiles'>) => a.fullName.localeCompare(b.fullName))
        .map((p: Doc<'profiles'>) => ({ profileId: p._id, fullName: p.fullName, jobTitle: p.jobTitle })),
    };
  },
});

// Code-free staff directory for PIN login: staff just pick their name and enter
// their PIN — no venue code needed. The venue is auto-provisioned when the owner
// account is first created. The private auth handle is never exposed here; it is
// only returned after a rate-limited PIN check in exchangePinForLogin.
export const getStaffDirectory = query({
  args: {},
  returns: v.array(
    v.object({
      profileId: v.id('profiles'),
      fullName: v.string(),
      jobTitle: v.string(),
      venueName: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const profiles = await ctx.db.query('profiles').collect();
    const venueNames = new Map<string, string>();
    const result: Array<{ profileId: Id<'profiles'>; fullName: string; jobTitle: string; venueName: string }> = [];
    for (const p of profiles) {
      if (!p.isPinUser || !p.loginHandle || !p.venueId) continue;
      const key = String(p.venueId);
      if (!venueNames.has(key)) {
        const venue = await ctx.db.get(p.venueId);
        venueNames.set(key, venue?.name ?? 'Venue');
      }
      result.push({ profileId: p._id, fullName: p.fullName, jobTitle: p.jobTitle, venueName: venueNames.get(key) ?? 'Venue' });
    }
    return result.sort((a, b) => a.fullName.localeCompare(b.fullName));
  },
});

// Managers reset a staff PIN: updates BOTH the Convex Auth account secret and
// the stored pinHash, and clears the lockout (recent failed attempts).
export const resetStaffPin = mutation({
  args: { venueId: v.id('venues'), profileId: v.id('profiles'), pin: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireVenueManager(ctx, args.venueId);
    if (!/^\d{4}$/.test(args.pin)) throw new Error('PIN must be exactly 4 digits');
    const profile = await ctx.db.get(args.profileId);
    if (!profile || profile.venueId !== args.venueId) {
      throw new Error('Staff member not found');
    }
    if (!profile.isPinUser || !profile.loginHandle) throw new Error('This staff member does not use PIN login');

    await modifyAccountCredentials(ctx as any, {
      provider: 'password',
      account: { id: profile.loginHandle, secret: args.pin },
    });
    const pinHash = await hashPin(args.venueId, profile.loginHandle, args.pin);
    await ctx.db.patch(profile._id, { pinHash });

    // Clear lockout history so the staffer can sign in immediately.
    const attempts = await ctx.db
      .query('pinLoginAttempts')
      .withIndex('by_profile_and_createdAt', (q: any) => q.eq('profileId', profile._id))
      .collect();
    for (const attempt of attempts) await ctx.db.delete(attempt._id);

    return null;
  },
});

export const exchangePinForLogin = mutation({
  // No venue code required: the staffer's venue is derived from their profile.
  args: { profileId: v.id('profiles'), pin: v.string() },
  returns: v.object({ loginHandle: v.string() }),
  handler: async (ctx, args) => {
    if (!/^\d{4}$/.test(args.pin)) throw new Error('Wrong PIN');

    const profile = await ctx.db.get(args.profileId);
    if (!profile || !profile.venueId || !profile.isPinUser || !profile.loginHandle) {
      throw new Error('Wrong PIN');
    }

    if (await recentPinFailures(ctx, profile._id) >= PIN_MAX_FAILURES) {
      throw new Error('Too many PIN attempts. Ask a manager to reset your PIN.');
    }

    if (!profile.pinHash) {
      throw new Error('This PIN must be reset by a manager before sign-in.');
    }

    const pinHash = await hashPin(profile.venueId, profile.loginHandle, args.pin);
    const success = pinHash === profile.pinHash;
    await recordPinAttempt(ctx, profile.venueId, profile._id, success);
    if (!success) throw new Error('Wrong PIN');
    return { loginHandle: profile.loginHandle };
  },
});
