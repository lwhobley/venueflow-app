export type WranglerServicePhase = 'pre_service' | 'active' | 'closing' | 'closed';

export function deriveWranglerServicePhase(input: {
  now: number;
  reservations: Array<{ reservationTime: number; durationMinutes: number; status: string }>;
  seatedTables: number;
}) : WranglerServicePhase {
  const activeReservations = input.reservations.filter((reservation) => !['cancelled', 'no_show'].includes(reservation.status));
  if (!activeReservations.length) return input.seatedTables > 0 ? 'active' : 'closed';

  const firstStart = Math.min(...activeReservations.map((reservation) => reservation.reservationTime));
  const lastEnd = Math.max(...activeReservations.map((reservation) => reservation.reservationTime + reservation.durationMinutes * 60_000));
  const preServiceWindowStart = firstStart - 120 * 60_000;
  const closingWindowEnd = lastEnd + 120 * 60_000;

  if (input.now < firstStart) return 'pre_service';
  if (input.seatedTables > 0 || input.now <= lastEnd) return 'active';
  if (input.now <= closingWindowEnd) return 'closing';
  if (input.now >= preServiceWindowStart && input.now < firstStart) return 'pre_service';
  return 'closed';
}

export function phaseLabel(phase: WranglerServicePhase) {
  if (phase === 'pre_service') return 'Pre-service';
  if (phase === 'active') return 'Live service';
  if (phase === 'closing') return 'Closing';
  return 'Service closed';
}
