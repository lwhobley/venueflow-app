import { internalAction, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';

// Internal: load the data the email action needs (actions can't touch the db).
export const getVenueForApproval = internalQuery({
  args: { venueId: v.id('venues') },
  returns: v.union(v.null(), v.object({ name: v.string(), approvalToken: v.union(v.string(), v.null()), approvalStatus: v.union(v.string(), v.null()) })),
  handler: async (ctx, args) => {
    const venue = await ctx.db.get(args.venueId);
    if (!venue) return null;
    return { name: venue.name, approvalToken: venue.approvalToken ?? null, approvalStatus: venue.approvalStatus ?? null };
  },
});

// Internal: approve a venue by its one-time token.
export const approveByToken = internalMutation({
  args: { token: v.string() },
  returns: v.union(v.null(), v.object({ name: v.string() })),
  handler: async (ctx, args) => {
    const venue = await ctx.db.query('venues').withIndex('by_approvalToken', (q: any) => q.eq('approvalToken', args.token)).first();
    if (!venue) return null;
    await ctx.db.patch(venue._id, { approvalStatus: 'approved', approvalToken: undefined });
    return { name: venue.name };
  },
});

// Internal action: email the site creator an approval link via Resend.
export const sendApprovalEmail = internalAction({
  args: { venueId: v.id('venues') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const apiKey = process.env.RESEND_API_KEY;
    const to = process.env.APPROVAL_NOTIFY_EMAIL;
    const from = process.env.APPROVAL_FROM_EMAIL ?? 'VenueFlow <onboarding@resend.dev>';
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (!apiKey || !to || !siteUrl) {
      console.warn('[approvals] Missing RESEND_API_KEY / APPROVAL_NOTIFY_EMAIL / CONVEX_SITE_URL — skipping email.');
      return null;
    }

    const venue = await ctx.runQuery(internal.approvals.getVenueForApproval, { venueId: args.venueId as Id<'venues'> });
    if (!venue || !venue.approvalToken) return null;

    const link = `${siteUrl}/approveVenue?token=${venue.approvalToken}`;
    const html = `
      <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 520px; margin: 0 auto;">
        <h2 style="color:#0B2B4C;">New VenueFlow account pending approval</h2>
        <p>A new venue account <strong>${venue.name}</strong> has signed up and is waiting for approval.</p>
        <p>
          <a href="${link}" style="display:inline-block; background:#17B7C8; color:#fff; padding:12px 22px; border-radius:12px; text-decoration:none; font-weight:700;">
            Approve this venue
          </a>
        </p>
        <p style="color:#607789; font-size:13px;">Or paste this link into your browser:<br/>${link}</p>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject: `Approve new VenueFlow venue: ${venue.name}`, html }),
    });
    if (!res.ok) {
      console.error('[approvals] Resend email failed:', res.status, await res.text());
    }
    return null;
  },
});
