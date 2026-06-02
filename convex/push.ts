import { internalMutation, mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';
import { getAuthUserId } from '@convex-dev/auth/server';
import type { Doc, Id } from './_generated/dataModel';

type AnyCtx = any;

const platformValue = v.union(v.literal('ios'), v.literal('android'), v.literal('web'), v.literal('unknown'));
const audienceValue = v.union(v.literal('managers'), v.literal('staff'), v.literal('profile'));

async function getProfile(ctx: AnyCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return await ctx.db.query('profiles').withIndex('by_userId', (q: any) => q.eq('userId', userId)).unique();
}

function isManager(role: string) {
  return role === 'admin' || role === 'owner' || role === 'manager';
}

export const registerPushToken = mutation({
  args: { token: v.string(), platform: platformValue },
  returns: v.object({ registered: v.boolean() }),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile?.venueId) return { registered: false };
    const now = Date.now();
    const existing = await (ctx as AnyCtx).db.query('pushTokens').withIndex('by_token', (q: any) => q.eq('token', args.token)).unique();
    if (existing) {
      await (ctx as AnyCtx).db.patch(existing._id, {
        venueId: profile.venueId,
        profileId: profile._id,
        platform: args.platform,
        enabled: true,
        lastSeenAt: now,
        updatedAt: now,
      });
      return { registered: true };
    }
    await (ctx as AnyCtx).db.insert('pushTokens', {
      venueId: profile.venueId,
      profileId: profile._id,
      token: args.token,
      platform: args.platform,
      enabled: true,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { registered: true };
  },
});

export const disablePushToken = mutation({
  args: { token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile?.venueId) return null;
    const existing = await (ctx as AnyCtx).db.query('pushTokens').withIndex('by_token', (q: any) => q.eq('token', args.token)).unique();
    if (existing && existing.profileId === profile._id) {
      await (ctx as AnyCtx).db.patch(existing._id, { enabled: false, updatedAt: Date.now() });
    }
    return null;
  },
});

export const getMyPushTokens = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id('pushTokens'),
      token: v.string(),
      platform: platformValue,
      enabled: v.boolean(),
      lastSeenAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const profile = await getProfile(ctx as AnyCtx);
    if (!profile) return [];
    const tokens = await (ctx as AnyCtx).db.query('pushTokens').withIndex('by_profile', (q: any) => q.eq('profileId', profile._id)).take(20);
    return tokens.map((token: Doc<'pushTokens'>) => ({
      _id: token._id,
      token: token.token,
      platform: token.platform,
      enabled: token.enabled,
      lastSeenAt: token.lastSeenAt,
    }));
  },
});

export const sendPushToAudience = internalMutation({
  args: {
    venueId: v.id('venues'),
    audience: audienceValue,
    profileId: v.optional(v.id('profiles')),
    title: v.string(),
    body: v.string(),
    data: v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.null()))),
  },
  returns: v.object({ scheduled: v.number() }),
  handler: async (ctx, args) => {
    const tokens = await (ctx as AnyCtx).db.query('pushTokens').withIndex('by_venue', (q: any) => q.eq('venueId', args.venueId)).take(500);
    const selected: string[] = [];
    for (const token of tokens as Doc<'pushTokens'>[]) {
      if (!token.enabled) continue;
      if (args.audience === 'profile' && token.profileId !== args.profileId) continue;
      if (args.audience === 'managers') {
        const profile = await (ctx as AnyCtx).db.get(token.profileId);
        if (!profile || !isManager(profile.role)) continue;
      }
      selected.push(token.token);
    }
    if (selected.length > 0) {
      await ctx.scheduler.runAfter(0, internal.notifications.sendNotification, {
        to: Array.from(new Set(selected)),
        title: args.title,
        body: args.body,
        data: args.data,
      });
    }
    return { scheduled: selected.length };
  },
});
