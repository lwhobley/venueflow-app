import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { getAuthUserId } from '@convex-dev/auth/server';
import type { Doc } from './_generated/dataModel';

type AnyCtx = any;

const role = v.union(v.literal('admin'), v.literal('owner'), v.literal('manager'), v.literal('server'), v.literal('staff'));

const profileValue = v.object({
  _id: v.id('profiles'),
  _creationTime: v.number(),
  tokenIdentifier: v.union(v.string(), v.null()),
  email: v.string(),
  fullName: v.string(),
  role,
  jobTitle: v.string(),
  venueId: v.union(v.id('venues'), v.null()),
  isPinUser: v.boolean(),
  isDemo: v.boolean(),
});

const venueValue = v.object({
  _id: v.id('venues'),
  _creationTime: v.number(),
  name: v.string(),
  latitude: v.number(),
  longitude: v.number(),
  geofenceRadiusM: v.number(),
  subscriptionStatus: v.union(
    v.literal('trialing'), v.literal('active'), v.literal('past_due'),
    v.literal('cancelled'), v.literal('expired'), v.literal('paused'), v.null(),
  ),
  subscriptionPlatform: v.union(v.literal('stripe'), v.literal('apple'), v.null()),
});

async function getProfile(ctx: AnyCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return await ctx.db.query('profiles').withIndex('by_userId', (q: any) => q.eq('userId', userId)).unique();
}

function isManager(roleName: string) {
  return roleName === 'admin' || roleName === 'owner' || roleName === 'manager';
}

function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function mapProfile(profile: Doc<'profiles'>) {
  return {
    _id: profile._id,
    _creationTime: profile._creationTime,
    tokenIdentifier: profile.tokenIdentifier ?? null,
    email: profile.email,
    fullName: profile.fullName,
    role: profile.role,
    jobTitle: profile.jobTitle,
    venueId: profile.venueId ?? null,
    isPinUser: Boolean(profile.isPinUser),
    isDemo: Boolean(profile.isDemo),
  };
}

function mapVenue(venue: Doc<'venues'>) {
  return {
    _id: venue._id,
    _creationTime: venue._creationTime,
    name: venue.name,
    latitude: venue.latitude,
    longitude: venue.longitude,
    geofenceRadiusM: venue.geofenceRadiusM,
    subscriptionStatus: (venue as any).subscriptionStatus ?? null,
    subscriptionPlatform: (venue as any).subscriptionPlatform ?? null,
  };
}

export const createInvite = mutation({
  args: {
    venueId: v.id('venues'),
    role,
    jobTitle: v.string(),
  },
  returns: v.object({ token: v.string(), inviteUrl: v.string() }),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile || profile.venueId !== args.venueId || !isManager(profile.role)) {
      throw new Error('Not authorized');
    }
    const token = generateToken();
    const now = Date.now();
    await (ctx as AnyCtx).db.insert('invites', {
      venueId: args.venueId,
      token,
      role: args.role,
      jobTitle: args.jobTitle,
      createdBy: profile._id,
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
      createdAt: now,
    });
    return { token, inviteUrl: `venuewrangler://join?invite=${token}` };
  },
});

export const getInvitePreview = query({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      venueName: v.string(),
      role,
      jobTitle: v.string(),
      expired: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const invite = await (ctx as AnyCtx).db.query('invites').withIndex('by_token', (q: any) => q.eq('token', args.token)).unique();
    if (!invite) return null;
    const venue = await (ctx as AnyCtx).db.get(invite.venueId);
    if (!venue) return null;
    return {
      venueName: venue.name,
      role: invite.role,
      jobTitle: invite.jobTitle,
      expired: invite.expiresAt < Date.now() || !!invite.usedBy,
    };
  },
});

export const redeemInvite = mutation({
  args: { token: v.string() },
  returns: v.object({ profile: profileValue, venue: venueValue }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx as AnyCtx);
    if (!userId) throw new Error('Unauthenticated');

    const invite = await (ctx as AnyCtx).db.query('invites').withIndex('by_token', (q: any) => q.eq('token', args.token)).unique();
    if (!invite) throw new Error('Invite not found or invalid');
    if (invite.expiresAt < Date.now()) throw new Error('This invite link has expired. Ask your manager for a new one.');
    if (invite.usedBy) throw new Error('This invite link has already been used.');

    const venue = await (ctx as AnyCtx).db.get(invite.venueId);
    if (!venue) throw new Error('Venue not found');

    let profile = await getProfile(ctx as AnyCtx);
    if (!profile) throw new Error('Profile not ready — please try again.');
    if (profile.venueId) throw new Error('You are already a member of a venue.');

    await (ctx as AnyCtx).db.patch(profile._id, {
      venueId: invite.venueId,
      role: invite.role,
      jobTitle: invite.jobTitle,
    });
    await (ctx as AnyCtx).db.patch(invite._id, { usedBy: profile._id });

    profile = await (ctx as AnyCtx).db.get(profile._id);
    if (!profile) throw new Error('Unable to update profile');

    return { profile: mapProfile(profile), venue: mapVenue(venue) };
  },
});
