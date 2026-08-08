import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { WranglerOperatorController } from './wrangler-operator.controller';

describe('WranglerOperatorController', () => {
  it('rejects fabricated direct execute plans from regular staff', async () => {
    const operator = { execute: vi.fn() };
    const controller = new WranglerOperatorController({} as never, operator as never);

    await expect(controller.execute({
      profileId: 'staff-1', fullName: 'Staff Member', venueId: 'venue-1', venueName: 'Venue',
      role: 'staff', allAccess: false, subscriptionStatus: 'active', trialEndsAt: null,
    }, { plan: { tool: 'CREATE_RESERVATION', args: {} } })).rejects.toBeInstanceOf(ForbiddenException);
    expect(operator.execute).not.toHaveBeenCalled();
  });
});
