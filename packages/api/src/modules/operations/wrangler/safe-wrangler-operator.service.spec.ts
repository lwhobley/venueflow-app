import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SafeWranglerOperatorService } from './safe-wrangler-operator.service';

describe('SafeWranglerOperatorService', () => {
  it('rejects direct write plans from non-manager members', async () => {
    const reservations = { saveReservation: vi.fn() };
    const service = new SafeWranglerOperatorService({} as never, reservations as never, {} as never);

    await expect(service.execute({
      venueId: 'venue-1',
      actor: { profileId: 'staff-1', fullName: 'Staff Member', role: 'staff', allAccess: false },
      plan: { tool: 'CREATE_RESERVATION', args: { guestName: 'Guest', partySize: 2, reservationTime: '2026-08-10T18:00:00.000Z' } },
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(reservations.saveReservation).not.toHaveBeenCalled();
  });
});
