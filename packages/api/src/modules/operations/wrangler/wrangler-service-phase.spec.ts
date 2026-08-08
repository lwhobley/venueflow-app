import { describe, expect, it } from 'vitest';
import { deriveWranglerServicePhase } from './wrangler-service-phase';

const START = new Date('2026-08-08T23:00:00.000Z').getTime();

describe('deriveWranglerServicePhase', () => {
  const reservations = [
    { reservationTime: START, durationMinutes: 90, status: 'confirmed' },
    { reservationTime: START + 120 * 60_000, durationMinutes: 90, status: 'confirmed' },
  ];

  it('returns pre_service before the first arrival', () => {
    expect(deriveWranglerServicePhase({ now: START - 30 * 60_000, reservations, seatedTables: 0 })).toBe('pre_service');
  });

  it('returns active during the reservation window', () => {
    expect(deriveWranglerServicePhase({ now: START + 30 * 60_000, reservations, seatedTables: 4 })).toBe('active');
  });

  it('returns closing after the last reservation window when the floor is clear', () => {
    const afterLastEnd = START + 120 * 60_000 + 90 * 60_000 + 15 * 60_000;
    expect(deriveWranglerServicePhase({ now: afterLastEnd, reservations, seatedTables: 0 })).toBe('closing');
  });

  it('keeps service active while guests remain seated', () => {
    const afterLastEnd = START + 120 * 60_000 + 90 * 60_000 + 15 * 60_000;
    expect(deriveWranglerServicePhase({ now: afterLastEnd, reservations, seatedTables: 2 })).toBe('active');
  });

  it('returns closed after the closing window', () => {
    const late = START + 120 * 60_000 + 90 * 60_000 + 180 * 60_000;
    expect(deriveWranglerServicePhase({ now: late, reservations, seatedTables: 0 })).toBe('closed');
  });
});
