import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { assertNotDemoProfile, requireProfile, requireVenueMember } from './authz';

const GENERAL_GROUP_NAME = 'All Staff';

async function venueProfiles(ctx: any, venueId: Id<'venues'>): Promise<Doc<'profiles'>[]> {
  return await ctx.db.query('profiles').withIndex('by_venueId', (q: any) => q.eq('venueId', venueId)).collect();
}

// Ensures the venue-wide group chat exists. Safe to call repeatedly.
export const ensureChatSetup = mutation({
  args: { venueId: v.id('venues') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const me = await requireVenueMember(ctx, args.venueId);
    assertNotDemoProfile(me);
    const groups = await ctx.db
      .query('conversations')
      .withIndex('by_venue', (q: any) => q.eq('venueId', args.venueId))
      .collect();
    const hasGeneral = groups.some((c: Doc<'conversations'>) => c.type === 'group');
    if (!hasGeneral) {
      await ctx.db.insert('conversations', {
        venueId: args.venueId,
        type: 'group',
        name: GENERAL_GROUP_NAME,
        memberIds: [],
      });
    }
    return null;
  },
});

// Creates an additional named group chat for the venue. Any venue member can
// start one (memberIds empty = visible to the whole venue, like All Staff).
export const createGroup = mutation({
  args: { venueId: v.id('venues'), name: v.string() },
  returns: v.id('conversations'),
  handler: async (ctx, args) => {
    const me = await requireVenueMember(ctx, args.venueId);
    assertNotDemoProfile(me);
    const name = args.name.trim();
    if (!name) throw new Error('Enter a group name');
    if (name.length > 100) throw new Error('Group name must be 100 characters or fewer');
    return await ctx.db.insert('conversations', {
      venueId: args.venueId,
      type: 'group',
      name,
      memberIds: [],
    });
  },
});

const conversationValue = v.object({
  _id: v.id('conversations'),
  type: v.union(v.literal('group'), v.literal('dm')),
  title: v.string(),
  lastMessageText: v.union(v.string(), v.null()),
  lastMessageAt: v.union(v.number(), v.null()),
});

export const listConversations = query({
  args: { venueId: v.id('venues') },
  returns: v.object({ groups: v.array(conversationValue), dms: v.array(conversationValue) }),
  handler: async (ctx, args) => {
    const me = await requireVenueMember(ctx, args.venueId);
    const all = await ctx.db
      .query('conversations')
      .withIndex('by_venue', (q: any) => q.eq('venueId', args.venueId))
      .collect();
    const staff = await venueProfiles(ctx, args.venueId);
    const nameById = new Map(staff.map((s: Doc<'profiles'>) => [s._id, s.fullName]));

    const groups = all
      .filter((c: Doc<'conversations'>) => c.type === 'group')
      .map((c: Doc<'conversations'>) => ({
        _id: c._id,
        type: 'group' as const,
        title: c.name ?? 'Group',
        lastMessageText: c.lastMessageText ?? null,
        lastMessageAt: c.lastMessageAt ?? null,
      }));

    const dms = all
      .filter((c: Doc<'conversations'>) => c.type === 'dm' && c.memberIds.some((id) => id === me._id))
      .map((c: Doc<'conversations'>) => {
        const otherId = c.memberIds.find((id) => id !== me._id);
        return {
          _id: c._id,
          type: 'dm' as const,
          title: (otherId && nameById.get(otherId)) || 'Direct message',
          lastMessageText: c.lastMessageText ?? null,
          lastMessageAt: c.lastMessageAt ?? null,
        };
      })
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));

    return { groups, dms };
  },
});

export const listDirectory = query({
  args: { venueId: v.id('venues') },
  returns: v.array(v.object({ _id: v.id('profiles'), fullName: v.string(), role: v.string(), jobTitle: v.string() })),
  handler: async (ctx, args) => {
    const me = await requireVenueMember(ctx, args.venueId);
    const staff = await venueProfiles(ctx, args.venueId);
    return staff
      .filter((s: Doc<'profiles'>) => s._id !== me._id)
      .map((s: Doc<'profiles'>) => ({ _id: s._id, fullName: s.fullName, role: s.role, jobTitle: s.jobTitle }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  },
});

export const openDm = mutation({
  args: { venueId: v.id('venues'), otherProfileId: v.id('profiles') },
  returns: v.id('conversations'),
  handler: async (ctx, args) => {
    const me = await requireVenueMember(ctx, args.venueId);
    assertNotDemoProfile(me);
    const other = await ctx.db.get(args.otherProfileId);
    if (!other || other.venueId !== args.venueId) throw new Error('User is not in this venue');

    const existing = await ctx.db
      .query('conversations')
      .withIndex('by_venue', (q: any) => q.eq('venueId', args.venueId))
      .collect();
    const match = existing.find(
      (c: Doc<'conversations'>) =>
        c.type === 'dm' &&
        c.memberIds.length === 2 &&
        c.memberIds.includes(me._id) &&
        c.memberIds.includes(args.otherProfileId),
    );
    if (match) return match._id;

    return await ctx.db.insert('conversations', {
      venueId: args.venueId,
      type: 'dm',
      memberIds: [me._id, args.otherProfileId],
    });
  },
});

const messageValue = v.object({
  _id: v.id('messages'),
  text: v.string(),
  senderName: v.string(),
  createdAt: v.number(),
  mine: v.boolean(),
});

async function assertConversationAccess(ctx: any, conversationId: Id<'conversations'>, me: Doc<'profiles'>) {
  const conv = await ctx.db.get(conversationId);
  if (!conv) throw new Error('Conversation not found');
  if (conv.venueId !== me.venueId) throw new Error('Not your venue');
  if (conv.type === 'dm' && !conv.memberIds.some((id: Id<'profiles'>) => id === me._id)) {
    throw new Error('Not a participant');
  }
  return conv as Doc<'conversations'>;
}

export const getMessages = query({
  args: { conversationId: v.id('conversations') },
  returns: v.object({ title: v.string(), messages: v.array(messageValue) }),
  handler: async (ctx, args) => {
    // Reading messages is a read operation — demo (read-only) profiles may
    // view chat. Do NOT assert non-demo here; that belongs on write
    // mutations (sendMessage, ensureChatSetup, openDm). A thrown error from
    // a query crashes the screen render.
    const me = await requireProfile(ctx);
    const conv = await assertConversationAccess(ctx, args.conversationId, me);
    const staff = me.venueId ? await venueProfiles(ctx, me.venueId) : [];
    const nameById = new Map(staff.map((s: Doc<'profiles'>) => [s._id, s.fullName]));

    let title = conv.name ?? 'Chat';
    if (conv.type === 'dm') {
      const otherId = conv.memberIds.find((id) => id !== me._id);
      title = (otherId && nameById.get(otherId)) || 'Direct message';
    }

    const rows = await ctx.db
      .query('messages')
      .withIndex('by_conversation', (q: any) => q.eq('conversationId', args.conversationId))
      .collect();
    rows.sort((a: Doc<'messages'>, b: Doc<'messages'>) => a.createdAt - b.createdAt);

    return {
      title,
      messages: rows.map((m: Doc<'messages'>) => ({
        _id: m._id,
        text: m.text,
        senderName: nameById.get(m.senderId) ?? 'Someone',
        createdAt: m.createdAt,
        mine: m.senderId === me._id,
      })),
    };
  },
});

export const sendMessage = mutation({
  args: { conversationId: v.id('conversations'), text: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const me = await requireProfile(ctx);
    const conv = await assertConversationAccess(ctx, args.conversationId, me);
    const text = args.text.trim();
    if (!text) return null;
    const now = Date.now();
    await ctx.db.insert('messages', {
      conversationId: conv._id,
      venueId: conv.venueId,
      senderId: me._id,
      text,
      createdAt: now,
    });
    await ctx.db.patch(conv._id, { lastMessageAt: now, lastMessageText: text.slice(0, 80) });
    return null;
  },
});
