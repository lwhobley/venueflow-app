import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

type AnyCtx = any;

export const check = internalMutation({
  args: {
    key: v.string(),
    limit: v.number(),
    windowMs: v.number(),
  },
  returns: v.object({ allowed: v.boolean(), retryAfterMs: v.number() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const windowStart = now - (now % args.windowMs);
    const row = await (ctx as AnyCtx).db
      .query("webhookRateLimits")
      .withIndex("by_key", (q: any) => q.eq("key", args.key))
      .unique();

    if (!row || row.windowStart !== windowStart) {
      if (row) {
        await (ctx as AnyCtx).db.patch(row._id, {
          windowStart,
          count: 1,
          updatedAt: now,
        });
      } else {
        await (ctx as AnyCtx).db.insert("webhookRateLimits", {
          key: args.key,
          windowStart,
          count: 1,
          updatedAt: now,
        });
      }
      return { allowed: true, retryAfterMs: 0 };
    }

    if (row.count >= args.limit) {
      return {
        allowed: false,
        retryAfterMs: Math.max(0, windowStart + args.windowMs - now),
      };
    }

    await (ctx as AnyCtx).db.patch(row._id, {
      count: row.count + 1,
      updatedAt: now,
    });
    return { allowed: true, retryAfterMs: 0 };
  },
});
