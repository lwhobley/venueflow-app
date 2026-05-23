import { internalAction, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';

const FROM_EMAIL = 'Venue Wrangler <admin@venuewrangler.com>';
const pinHandleDomain = '@pin.venueflow';

function isDeliverableEmail(email: string) {
  return email.includes('@') && !email.endsWith(pinHandleDomain) && !email.endsWith('@venueflow.local');
}

function minutesToTime(minutes: number) {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${mins.toString().padStart(2, '0')} ${suffix}`;
}

const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function shiftLine(shift: Doc<'scheduleShifts'>) {
  return `${dayLabels[shift.dayIndex] ?? 'Day'} ${minutesToTime(shift.startMinutes)}-${minutesToTime(shift.endMinutes)} - ${shift.jobTitle}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

export const getPublishRecipients = internalQuery({
  args: { venueId: v.id('venues') },
  returns: v.array(
    v.object({
      profileId: v.id('profiles'),
      email: v.string(),
      fullName: v.string(),
      shifts: v.array(v.object({ line: v.string() })),
    }),
  ),
  handler: async (ctx, args) => {
    const profiles = await ctx.db.query('profiles').withIndex('by_venueId', (q: any) => q.eq('venueId', args.venueId)).collect();
    const shifts = await ctx.db.query('scheduleShifts').withIndex('by_venueId', (q: any) => q.eq('venueId', args.venueId)).collect();
    return profiles
      .filter((profile: Doc<'profiles'>) => isDeliverableEmail(profile.email))
      .map((profile: Doc<'profiles'>) => ({
        profileId: profile._id,
        email: profile.email,
        fullName: profile.fullName,
        shifts: shifts.filter((shift: Doc<'scheduleShifts'>) => shift.profileId === profile._id).map((shift: Doc<'scheduleShifts'>) => ({ line: shiftLine(shift) })),
      }));
  },
});

export const getShiftRecipient = internalQuery({
  args: { venueId: v.id('venues'), profileId: v.id('profiles'), shiftId: v.id('scheduleShifts') },
  returns: v.union(
    v.null(),
    v.object({
      profileId: v.id('profiles'),
      email: v.string(),
      fullName: v.string(),
      shiftLine: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.profileId);
    const shift = await ctx.db.get(args.shiftId);
    if (!profile || !shift || profile.venueId !== args.venueId || shift.venueId !== args.venueId || !isDeliverableEmail(profile.email)) return null;
    return { profileId: profile._id, email: profile.email, fullName: profile.fullName, shiftLine: shiftLine(shift) };
  },
});

export const recordEmailSent = internalMutation({
  args: {
    venueId: v.id('venues'),
    profileId: v.id('profiles'),
    shiftId: v.optional(v.id('scheduleShifts')),
    kind: v.union(v.literal('schedule_published'), v.literal('shift_changed')),
    email: v.string(),
    subject: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert('scheduleEmailEvents', {
      venueId: args.venueId,
      profileId: args.profileId,
      shiftId: args.shiftId,
      kind: args.kind,
      email: args.email,
      subject: args.subject,
      sentAt: Date.now(),
    });
    return null;
  },
});

async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[scheduleEmails] Missing RESEND_API_KEY - skipping email.');
    return false;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  if (!response.ok) {
    console.error('[scheduleEmails] Resend email failed:', response.status, await response.text());
    return false;
  }
  return true;
}

export const sendSchedulePublishedEmails = internalAction({
  args: { venueId: v.id('venues') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const recipients = await ctx.runQuery(internal.scheduleEmails.getPublishRecipients, { venueId: args.venueId });
    for (const recipient of recipients) {
      const shiftHtml = recipient.shifts.length
        ? `<ul>${recipient.shifts.map((shift) => `<li>${escapeHtml(shift.line)}</li>`).join('')}</ul>`
        : '<p>You do not have assigned shifts in this published schedule yet.</p>';
      const subject = 'Your Venue Wrangler schedule was published';
      const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5"><h2>Schedule published</h2><p>Hi ${escapeHtml(recipient.fullName)}, your latest schedule is ready.</p>${shiftHtml}</div>`;
      if (await sendEmail(recipient.email, subject, html)) {
        await ctx.runMutation(internal.scheduleEmails.recordEmailSent, { venueId: args.venueId, profileId: recipient.profileId, kind: 'schedule_published', email: recipient.email, subject });
      }
    }
    return null;
  },
});

export const sendShiftChangedEmail = internalAction({
  args: { venueId: v.id('venues'), profileId: v.id('profiles'), shiftId: v.id('scheduleShifts') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const recipient = await ctx.runQuery(internal.scheduleEmails.getShiftRecipient, args);
    if (!recipient) return null;
    const subject = 'Your Venue Wrangler shift was updated';
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5"><h2>Schedule change</h2><p>Hi ${escapeHtml(recipient.fullName)}, a shift on your schedule changed.</p><p><strong>${escapeHtml(recipient.shiftLine)}</strong></p></div>`;
    if (await sendEmail(recipient.email, subject, html)) {
      await ctx.runMutation(internal.scheduleEmails.recordEmailSent, { venueId: args.venueId, profileId: recipient.profileId, shiftId: args.shiftId as Id<'scheduleShifts'>, kind: 'shift_changed', email: recipient.email, subject });
    }
    return null;
  },
});
