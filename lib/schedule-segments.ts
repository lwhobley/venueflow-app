export type CalendarShift = {
  _id: string;
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
};

export type CalendarShiftSegment<T extends CalendarShift> = T & {
  segmentKey: string;
  renderStart: number;
  renderEnd: number;
};

function normalizedEnd(shift: CalendarShift): number {
  return shift.endMinutes <= shift.startMinutes ? shift.endMinutes + 1440 : shift.endMinutes;
}

export function calendarSegmentsForDay<T extends CalendarShift>(
  shifts: T[],
  previousSaturdayOvernights: T[],
  dayIndex: number,
): CalendarShiftSegment<T>[] {
  const segments: CalendarShiftSegment<T>[] = [];

  if (dayIndex === 0) {
    for (const shift of previousSaturdayOvernights) {
      const end = normalizedEnd(shift);
      if (shift.dayIndex === 6 && end > 1440) {
        segments.push({ ...shift, segmentKey: `${shift._id}:carry-in`, renderStart: 0, renderEnd: end - 1440 });
      }
    }
  }

  for (const shift of shifts) {
    const end = normalizedEnd(shift);
    if (shift.dayIndex === dayIndex) {
      segments.push({ ...shift, segmentKey: `${shift._id}:start`, renderStart: shift.startMinutes, renderEnd: Math.min(1440, end) });
    }
    if (shift.dayIndex < 6 && shift.dayIndex + 1 === dayIndex && end > 1440) {
      segments.push({ ...shift, segmentKey: `${shift._id}:spill`, renderStart: 0, renderEnd: end - 1440 });
    }
  }

  return segments;
}
