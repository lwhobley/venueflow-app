import { describe, expect, it, vi } from 'vitest';
import { syncTeamMemberCount } from './team-sync';

describe('syncTeamMemberCount', () => {
  it('upserts the per-venue team so concurrent creates cannot duplicate', async () => {
    const tx = {
      profile: { count: vi.fn().mockResolvedValue(4) },
      team: { upsert: vi.fn().mockResolvedValue({ id: 'team-1' }) },
    };

    await syncTeamMemberCount(tx as any, 'venue-1');

    expect(tx.team.upsert).toHaveBeenCalledWith({
      where: { venueId: 'venue-1' },
      create: { venueId: 'venue-1', name: 'Default Team', memberCount: 4 },
      update: { memberCount: 4 },
    });
  });

  it('no-ops when venueId is missing', async () => {
    const tx = { profile: { count: vi.fn() }, team: { upsert: vi.fn() } };
    await syncTeamMemberCount(tx as any, null);
    expect(tx.profile.count).not.toHaveBeenCalled();
  });
});
