import { mutation } from './_generated/server';
import { v } from 'convex/values';
import { createAccount } from '@convex-dev/auth/server';
import type { Id } from './_generated/dataModel';

export const bootstrapDemo = mutation({
  args: {},
  returns: v.object({ email: v.string(), password: v.string() }),
  handler: async (ctx) => {
    // Demo is enabled by default so the "Try demo" button works out of the box.
    // Set DEMO_ENABLED=false in the Convex deployment to turn it off (e.g. prod).
    if (process.env.DEMO_ENABLED === 'false') {
      throw new Error('Demo mode is not enabled on this deployment.');
    }

    const DEMO_EMAIL = process.env.DEMO_EMAIL ?? 'demo@venueflow.app';
    const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demopass1';

    // Check if demo profile already exists (idempotent)
    const existing = await ctx.db
      .query('profiles')
      .withIndex('by_email', (q: any) => q.eq('email', DEMO_EMAIL))
      .first();

    if (existing) {
      return { email: DEMO_EMAIL, password: DEMO_PASSWORD };
    }

    // Create the Convex Auth account for the demo user
    const { user } = await createAccount(ctx as any, {
      provider: 'password',
      account: { id: DEMO_EMAIL, secret: DEMO_PASSWORD },
      profile: { email: DEMO_EMAIL },
    });

    // Create demo venue with active subscription (never gated)
    const venueId = await ctx.db.insert('venues', {
      name: 'Demo Venue',
      latitude: 40.7128,
      longitude: -74.006,
      geofenceRadiusM: 5000,
      subscriptionStatus: 'active',
      subscriptionPlatform: null,
    });

    // Create demo owner profile linked to the auth account
    await ctx.db.insert('profiles', {
      userId: user._id as Id<'users'>,
      email: DEMO_EMAIL,
      fullName: 'Demo Owner',
      role: 'owner',
      jobTitle: 'Owner',
      venueId,
      trialEndsAt: Date.now() + 10 * 365 * 24 * 60 * 60 * 1000,
    });

    return { email: DEMO_EMAIL, password: DEMO_PASSWORD };
  },
});
