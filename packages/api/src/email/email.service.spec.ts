import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailService } from './email.service';

function makeService() {
  const configValues: Record<string, string> = {
    RESEND_API_KEY: 're_test_key',
    EMAIL_FROM: 'Venue Wrangler <no-reply@venuewrangler.com>',
  };
  const config = { get: vi.fn((key: string) => configValues[key]) } as any;
  const prisma = {
    profile: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  } as any;
  const service = new EmailService(config, prisma);
  return { service, config, prisma };
}

describe('EmailService', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '' }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('sendOrThrow', () => {
    it('sends to a normalized recipient list', async () => {
      const { service } = makeService();
      await service.sendOrThrow({ to: ' Staff@Example.com ', subject: 'Hi', text: 'body' });

      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.to).toEqual(['staff@example.com']);
      expect(body.bcc).toBeUndefined();
    });

    it('no-ops when both to and bcc are empty', async () => {
      const { service } = makeService();
      await service.sendOrThrow({ to: [], subject: 'Hi', text: 'body' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('includes a bcc field when provided', async () => {
      const { service } = makeService();
      await service.sendOrThrow({
        to: 'no-reply@venuewrangler.com',
        bcc: ['a@example.com', 'B@Example.com', 'a@example.com'],
        subject: 'Hi',
        text: 'body',
      });

      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.to).toEqual(['no-reply@venuewrangler.com']);
      expect(body.bcc).toEqual(['a@example.com', 'b@example.com']);
    });
  });

  describe('sendToProfiles', () => {
    it('broadcasts via bcc so recipients cannot see each other in "to"', async () => {
      const { service } = makeService();
      await service.sendToProfiles(
        [
          { id: 'p1', email: 'manager1@example.com' },
          { id: 'p2', email: 'manager2@example.com' },
        ],
        { subject: 'Schedule published', text: 'body' },
      );

      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.to).toEqual(['venue wrangler <no-reply@venuewrangler.com>']);
      expect(body.bcc).toEqual(['manager1@example.com', 'manager2@example.com']);
    });

    it('does not send when there are no recipients', async () => {
      const { service } = makeService();
      await service.sendToProfiles([], { subject: 'Schedule published', text: 'body' });
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('sendToVenueManagers / sendToVenueStaff', () => {
    it('looks up managers scoped to the venue and broadcasts via bcc', async () => {
      const { service, prisma } = makeService();
      prisma.profile.findMany.mockResolvedValue([{ id: 'm1', email: 'mgr@example.com', fullName: 'Mgr' }]);

      await service.sendToVenueManagers('venue-1', { subject: 'Alert', text: 'body' });

      expect(prisma.profile.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ venueId: 'venue-1' }),
      }));
      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.bcc).toEqual(['mgr@example.com']);
    });

    it('swallows recipient lookup failures instead of throwing', async () => {
      const { service, prisma } = makeService();
      prisma.profile.findMany.mockRejectedValue(new Error('db down'));

      await expect(service.sendToVenueStaff('venue-1', { subject: 'Alert', text: 'body' })).resolves.toBeUndefined();
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('sendToProfile', () => {
    it('sends to the single profile email', async () => {
      const { service, prisma } = makeService();
      prisma.profile.findUnique.mockResolvedValue({ email: 'staff@example.com' });

      await service.sendToProfile('profile-1', { subject: 'Hi', text: 'body' });

      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.to).toEqual(['staff@example.com']);
    });

    it('does nothing when the profile is not found', async () => {
      const { service, prisma } = makeService();
      prisma.profile.findUnique.mockResolvedValue(null);

      await service.sendToProfile('missing', { subject: 'Hi', text: 'body' });
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
