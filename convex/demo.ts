import { mutation } from './_generated/server';
import { v } from 'convex/values';
import { getAuthUserId } from '@convex-dev/auth/server';
import type { Id } from './_generated/dataModel';

// Called from the client AFTER Convex Auth has already signed the user in
// (via the normal password flow). This mutation ensures the demo venue and
// owner profile exist and are linked to the authenticated user.
export const bootstrapDemo = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // Demo is enabled by default. Set DEMO_ENABLED=false to disable (e.g. prod).
    if (process.env.DEMO_ENABLED === 'false') {
      throw new Error('Demo mode is not enabled on this deployment.');
    }

    const DEMO_EMAIL = process.env.DEMO_EMAIL ?? 'demo@venueflow.app';

    const userId = await getAuthUserId(ctx as any);
    if (!userId) throw new Error('Not authenticated');

    // Check if this user already has a fully-configured demo profile.
    const existingByUser = await ctx.db
      .query('profiles')
      .withIndex('by_userId', (q: any) => q.eq('userId', userId))
      .first();

    if (existingByUser?.venueId) {
      return null;
    }

    // Create the demo venue with a permanent active subscription.
    const venueId = await ctx.db.insert('venues', {
      name: 'Demo Venue',
      latitude: 40.7128,
      longitude: -74.006,
      geofenceRadiusM: 5000,
      subscriptionStatus: 'active',
      subscriptionPlatform: null,
    });

    if (existingByUser) {
      // Profile exists (created by bootstrapProfile before this ran) — patch in
      // the venue and promote to owner.
      await ctx.db.patch(existingByUser._id, {
        venueId,
        role: 'owner',
        jobTitle: 'Owner',
        fullName: 'Demo Owner',
        trialEndsAt: Date.now() + 10 * 365 * 24 * 60 * 60 * 1000,
      });
    } else {
      // No profile yet — create the full owner profile so bootstrapProfile
      // finds it on the next call.
      await ctx.db.insert('profiles', {
        userId: userId as Id<'users'>,
        email: DEMO_EMAIL,
        fullName: 'Demo Owner',
        role: 'owner',
        jobTitle: 'Owner',
        venueId,
        trialEndsAt: Date.now() + 10 * 365 * 24 * 60 * 60 * 1000,
      });
    }

    return null;
  },
});
