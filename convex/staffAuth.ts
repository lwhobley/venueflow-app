import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { createAccount } from '@convex-dev/auth/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireVenueManager, requireVenueMember } from './authz';

const accessRoleValue = v.union(v.literal('manager'), v.literal('server'), v.literal('staff'));

function randomCode(len = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
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
    });

    return { loginHandle: handle };
  },
});

// ---------- Public roster for PIN login ----------
// No auth required: staff entering a venue code see names to pick, then PIN in.

export const getVenueRoster = query({
  args: { code: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      venueName: v.string(),
      staff: v.array(v.object({ profileId: v.id('profiles'), fullName: v.string(), jobTitle: v.string(), loginHandle: v.string() })),
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
        .map((p: Doc<'profiles'>) => ({ profileId: p._id, fullName: p.fullName, jobTitle: p.jobTitle, loginHandle: p.loginHandle as string })),
    };
  },
});
