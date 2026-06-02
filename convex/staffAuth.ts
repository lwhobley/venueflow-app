import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { requireVenueManager, requireVenueMember } from './authz';

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
