import { addDays } from './pay-period';
import { normalizedShiftEnd } from './venue-time';

export type ShiftWindow = {
  weekStart?: string | null;
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
};

export type OccupiedSlot = {
  weekStart: string | null;
  dayIndex: number;
  start: number;
  end: number;
};

export function nextCalendarDay(
  weekStart: string | null | undefined,
  dayIndex: number,
): { weekStart: string | null; dayIndex: number } {
  if (dayIndex < 6) return { weekStart: weekStart ?? null, dayIndex: dayIndex + 1 };
  if (!weekStart) return { weekStart: null, dayIndex: 0 };
  return { weekStart: addDays(weekStart, 7), dayIndex: 0 };
}

export function occupiedSlots(shift: ShiftWindow): OccupiedSlot[] {
  const end = normalizedShiftEnd(shift.startMinutes, shift.endMinutes);
  const weekStart = shift.weekStart ?? null;
  const sameDayEnd = Math.min(end, 1440);
  const slots: OccupiedSlot[] = [
    { weekStart, dayIndex: shift.dayIndex, start: shift.startMinutes, end: sameDayEnd },
  ];
  if (end > 1440) {
    const next = nextCalendarDay(weekStart, shift.dayIndex);
    slots.push({ weekStart: next.weekStart, dayIndex: next.dayIndex, start: 0, end: end - 1440 });
  }
  return slots;
}

function sameCalendarDay(a: OccupiedSlot, b: OccupiedSlot): boolean {
  if (a.weekStart && b.weekStart) return a.weekStart === b.weekStart && a.dayIndex === b.dayIndex;
  return a.dayIndex === b.dayIndex;
}

export function shiftsOverlap(a: ShiftWindow, b: ShiftWindow): boolean {
  const left = occupiedSlots(a);
  const right = occupiedSlots(b);
  return left.some((slotA) =>
    right.some((slotB) =>
      sameCalendarDay(slotA, slotB) && slotA.start < slotB.end && slotA.end > slotB.start,
    ),
  );
}

export function assignmentDayKeys(shift: ShiftWindow): Array<{ weekStart?: string; dayIndex: number }> {
  return occupiedSlots(shift).map((slot) => ({
    ...(slot.weekStart ? { weekStart: slot.weekStart } : {}),
    dayIndex: slot.dayIndex,
  }));
}
