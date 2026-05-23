import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';

const FROM_EMAIL = 'Venue Wrangler <admin@venuewrangler.com>';

function isDeliverableEmail(email: string) {
  const lower = email.toLowerCase();
  return lower.includes('@') && !lower.endsWith('@pin.venueflow') && !lower.endsWith('@pin.venuewrangler') && !lower.endsWith('@venueflow.local') && !lower.endsWith('@venuewrangler.local');
}

function minutesToTime(minutes: number) {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${mins.toString().padStart(2, '0')} ${suffix}`;
}

function dayLabel(index: number) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][index] ?? 'Day';
}

function shiftLine(shift: Doc<'scheduleShifts'>) {
  return `${dayLabel(shift.dayIndex)} ${minutesToTime(shift.startMinutes)}-${minutesToTime(shift.endMinutes)} - ${shift.jobTitle} (${shift.station})`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
}

export const getPublishRecipients = internalQuery({
  args: { venueId: v.id('venues') },
  returns: v.array(v.object({
    profileId: v.id('profiles'),
    email: v.string(),
    fullName: v.string(),
    venueName: v.string(),
    shifts: v.array(v.string()),
  })),
  handler: async (ctx, args) => {
    const venue = await ctx.db.get(args.venueId);
    if (!venue) return [];
    const profiles = await ctx.db.query('profiles').withIndex('by_venueId', (q: any) => q.eq('venueId', args.venueId)).collect();
    const shifts = await ctx.db.query('scheduleShifts').withIndex('by_venueId', (q: any) => q.eq('venueId', args.venueId)).collect();
    return profiles
      .filter((profile: Doc<'profiles'>) => isDeliverableEmail(profile.email))
      .map((profile: Doc<'profiles'>) => ({
        profileId: profile._id,
        email: profile.email,
        fullName: profile.fullName,
        venueName: venue.name,
        shifts: shifts
          .filter((shift: Doc<'scheduleShifts'>) => shift.profileId === profile._id)
          .sort((a: Doc<'scheduleShifts'>, b: Doc<'scheduleShifts'>) => a.dayIndex - b.dayIndex || a.startMinutes - b.startMinutes)
          .map(shiftLine),
      }));
  },
});

export const getShiftRecipient = internalQuery({
  args: { venueId: v.id('venues'), profileId: v.id('profiles'), shiftId: v.id('scheduleShifts') },
  returns: v.union(v.null(), v.object({
    profileId: v.id('profiles'),
    email: v.string(),
    fullName: v.string(),
    venueName: v.string(),
    shift: v.string(),
  })),
  handler: async (ctx, args) => {
    const [venue, profile, shift] = await Promise.all([ctx.db.get(args.venueId), ctx.db.get(args.profileId), ctx.db.get(args.shiftId)]);
    if (!venue || !profile || !shift || shift.venueId !== args.venueId || shift.profileId !== args.profileId || !isDeliverableEmail(profile.email)) return null;
    return { profileId: profile._id, email: profile.email, fullName: profile.fullName, venueName: venue.name, shift: shiftLine(shift) };
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
    await ctx.db.insert('scheduleEmailEvents', { ...args, sentAt: Date.now() });
    return null;
  },
});

async function sendEmail(args: { to: string; subject: string; html: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[scheduleEmails] RESEND_API_KEY is not set; skipping schedule email.');
    return false;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to: args.to, subject: args.subject, html: args.html }),
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
    const recipients = await ctx.runQuery(internal.scheduleEmails.getPublishRecipients, args);
    for (const recipient of recipients) {
      const subject = `${recipient.venueName} schedule published`;
      const body = recipient.shifts.length
        ? `<p>Your schedule is published:</p><ul>${recipient.shifts.map((shift) => `<li>${escapeHtml(shift)}</li>`).join('')}</ul>`
        : '<p>The schedule has been published. You do not have assigned shifts yet.</p>';
      const sent = await sendEmail({
        to: recipient.email,
        subject,
        html: `<div style="font-family:Arial,sans-serif;color:#0F2238"><h2>Schedule published</h2><p>Hi ${escapeHtml(recipient.fullName)},</p>${body}<p>Venue Wrangler</p></div>`,
      });
      if (sent) {
        await ctx.runMutation(internal.scheduleEmails.recordEmailSent, {
          venueId: args.venueId,
          profileId: recipient.profileId,
          kind: 'schedule_published',
          email: recipient.email,
          subject,
        });
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
    const subject = `${recipient.venueName} schedule updated`;
    const sent = await sendEmail({
      to: recipient.email,
      subject,
      html: `<div style="font-family:Arial,sans-serif;color:#0F2238"><h2>Schedule updated</h2><p>Hi ${escapeHtml(recipient.fullName)},</p><p>Your shift changed:</p><p><strong>${escapeHtml(recipient.shift)}</strong></p><p>Venue Wrangler</p></div>`,
    });
    if (sent) {
      await ctx.runMutation(internal.scheduleEmails.recordEmailSent, {
        venueId: args.venueId,
        profileId: recipient.profileId,
        shiftId: args.shiftId,
        kind: 'shift_changed',
        email: recipient.email,
        subject,
      });
    }
    return null;
  },
});
