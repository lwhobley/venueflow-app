import { describe, expect, it, vi } from 'vitest';
import { ChatController } from './chat.controller';

function makeController(overrides?: {
  conversation?: any;
  message?: any;
}) {
  const prisma = {
    conversation: {
      findFirst: vi.fn().mockResolvedValue(overrides?.conversation ?? null),
      delete: vi.fn().mockReturnValue('conversation-delete'),
    },
    message: {
      findFirst: vi.fn().mockResolvedValue(overrides?.message ?? null),
      update: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockReturnValue('message-delete-many'),
    },
    $transaction: vi.fn().mockResolvedValue([]),
  } as any;

  const controller = new ChatController(
    prisma,
    {} as any,
    {} as any,
  );

  return { controller, prisma };
}

const managerScope = {
  venueId: 'venue-1',
  profileId: 'manager-1',
  role: 'manager',
  allAccess: false,
} as any;

const staffScope = {
  venueId: 'venue-1',
  profileId: 'staff-1',
  role: 'staff',
  allAccess: false,
} as any;

describe('ChatController', () => {
  it('does not let managers delete direct messages or system conversations', async () => {
    const { controller, prisma } = makeController({
      conversation: {
        id: 'conv-1',
        venueId: 'venue-1',
        type: 'dm',
        name: null,
        memberIds: ['staff-1', 'staff-2'],
      },
    });

    await expect(controller.deleteConversation(managerScope, 'conv-1')).rejects.toThrow(
      'Only custom group chats can be deleted',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('still lets managers delete custom group chats', async () => {
    const { controller, prisma } = makeController({
      conversation: {
        id: 'conv-1',
        venueId: 'venue-1',
        type: 'group',
        name: 'Closing Crew',
        memberIds: ['staff-1', 'staff-2'],
      },
    });

    await expect(controller.deleteConversation(managerScope, 'conv-1')).resolves.toEqual({ ok: true });
    expect(prisma.message.deleteMany).toHaveBeenCalledWith({ where: { conversationId: 'conv-1' } });
    expect(prisma.conversation.delete).toHaveBeenCalledWith({ where: { id: 'conv-1' } });
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('requires conversation membership before reacting to a message', async () => {
    const { controller, prisma } = makeController({
      message: {
        id: 'msg-1',
        venueId: 'venue-1',
        conversationId: 'conv-1',
        senderId: 'staff-2',
        reactions: {},
      },
      conversation: {
        id: 'conv-1',
        venueId: 'venue-1',
        type: 'dm',
        name: null,
        memberIds: ['staff-2', 'staff-3'],
      },
    });

    await expect(controller.toggleReaction(staffScope, 'msg-1', { emoji: '👍' })).rejects.toThrow('Not a participant');
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('only lets the sender edit their own message', async () => {
    const { controller, prisma } = makeController({
      message: {
        id: 'msg-1',
        venueId: 'venue-1',
        conversationId: 'conv-1',
        senderId: 'staff-2',
        text: 'Original',
      },
      conversation: {
        id: 'conv-1',
        venueId: 'venue-1',
        type: 'group',
        name: 'Closing Crew',
        memberIds: ['staff-1', 'staff-2'],
      },
    });

    await expect(controller.editMessage(staffScope, 'msg-1', { text: 'Edited' })).rejects.toThrow(
      'Only the sender can edit this message',
    );
    expect(prisma.message.update).not.toHaveBeenCalled();
  });
});
