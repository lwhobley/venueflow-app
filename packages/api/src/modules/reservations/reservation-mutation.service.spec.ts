import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ReservationMutationService } from './reservation-mutation.service';

describe('ReservationMutationService', () => {
  it('creates a reservation after normalizing fields', async () => {
    const reservation = {
      id: 'reservation-1',
      status: 'confirmed',
      guestEmail: 'guest@example.com',
    };
    const prisma = {
      reservationHold: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      reservation: {
        create: vi.fn().mockResolvedValue(reservation),
      },
    };
    const service = new ReservationMutationService(prisma as any);

    const result = await service.saveReservation({
      venueId: 'venue-1',
      guestName: '  Alex Guest ',
      partySize: 4,
      reservationTime: '2026-06-28T19:00:00.000Z',
      notes: '  window seat ',
      specialRequests: '  anniversary ',
      phone: ' 555-1212 ',
      email: ' guest@example.com ',
    });

    expect(result).toEqual({ reservation, previousStatus: null });
    expect(prisma.reservation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        venueId: 'venue-1',
        guestName: 'Alex Guest',
        partySize: 4,
        status: 'confirmed',
        source: 'direct',
        notes: 'window seat',
        specialRequests: 'anniversary',
        guestPhone: '555-1212',
        guestEmail: 'guest@example.com',
        durationMinutes: 90,
      }),
    });
  });

  it('creates an execution workspace immediately for a private event', async () => {
    const reservation = {
      id: 'reservation-private', venueId: 'venue-1', status: 'confirmed', isPrivateEvent: true,
      eventName: 'Launch Party', guestName: 'Alex Guest', reservationTime: new Date('2026-08-01T18:00:00Z'),
      durationMinutes: 240, setupStyle: 'cocktail', eventSpace: 'Main Room',
    };
    const prisma = {
      reservationHold: { findFirst: vi.fn().mockResolvedValue(null) },
      reservation: { create: vi.fn().mockResolvedValue(reservation) },
    };
    const autopilot = { ensureWorkspace: vi.fn().mockResolvedValue({ id: 'workspace-1' }) };
    const service = new ReservationMutationService(prisma as any, autopilot as any);

    await service.saveReservation({
      venueId: 'venue-1', guestName: 'Alex Guest', partySize: 50,
      reservationTime: '2026-08-01T18:00:00Z', durationMinutes: 240,
      isPrivateEvent: true, eventName: 'Launch Party', setupStyle: 'cocktail',
    });

    expect(autopilot.ensureWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      venueId: 'venue-1', sourceType: 'reservation', sourceId: 'reservation-private', title: 'Launch Party',
    }));
  });

  it('rejects reservations that overlap a hold', async () => {
    const prisma = {
      reservationHold: {
        findFirst: vi.fn().mockResolvedValue({ reason: 'Private event buyout' }),
      },
    };
    const service = new ReservationMutationService(prisma as any);

    await expect(
      service.saveReservation({
        venueId: 'venue-1',
        guestName: 'Alex Guest',
        partySize: 4,
        reservationTime: '2026-06-28T19:00:00.000Z',
      }),
    ).rejects.toThrow('This time conflicts with a hold: Private event buyout');
  });

  it('updates an existing reservation and returns previous status', async () => {
    const existing = { id: 'reservation-2', status: 'requested' };
    const updated = { id: 'reservation-2', status: 'confirmed', guestEmail: 'guest@example.com' };
    const prisma = {
      reservationHold: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      reservation: {
        findFirst: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockResolvedValue(updated),
      },
    };
    const service = new ReservationMutationService(prisma as any);

    const result = await service.saveReservation({
      venueId: 'venue-1',
      reservationId: 'reservation-2',
      guestName: 'Alex Guest',
      partySize: 4,
      reservationTime: '2026-06-28T19:00:00.000Z',
      status: 'confirmed',
    });

    expect(result).toEqual({ reservation: updated, previousStatus: 'requested' });
  });

  it('creates and trims a reservation hold', async () => {
    const created = { id: 'hold-1' };
    const prisma = {
      reservationHold: {
        create: vi.fn().mockResolvedValue(created),
      },
    };
    const service = new ReservationMutationService(prisma as any);

    const result = await service.createHold({
      venueId: 'venue-1',
      startsAt: '2026-06-28T18:00:00.000Z',
      endsAt: '2026-06-28T20:00:00.000Z',
      reason: '  Staff training ',
    });

    expect(result).toBe(created);
    expect(prisma.reservationHold.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        venueId: 'venue-1',
        reason: 'Staff training',
      }),
    });
  });

  it('rejects deleting a missing hold', async () => {
    const prisma = {
      reservationHold: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    const service = new ReservationMutationService(prisma as any);

    await expect(service.deleteHold({ venueId: 'venue-1', holdId: 'missing' })).rejects.toThrow(
      BadRequestException,
    );
  });
});
