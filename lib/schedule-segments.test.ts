import { describe, expect, it } from 'vitest';
import { calendarSegmentsForDay } from './schedule-segments';

describe('calendarSegmentsForDay', () => {
  it('renders a previous-week Saturday overnight carry-in on Sunday', () => {
    const previousSaturday = { _id: 'shift-sat', dayIndex: 6, startMinutes: 1320, endMinutes: 1560 };

    expect(calendarSegmentsForDay([], [previousSaturday], 0)).toEqual([
      expect.objectContaining({ segmentKey: 'shift-sat:carry-in', renderStart: 0, renderEnd: 120 }),
    ]);
    expect(calendarSegmentsForDay([], [previousSaturday], 1)).toEqual([]);
  });

  it('keeps current-week overnight segmentation unchanged', () => {
    const sunday = { _id: 'shift-sun', dayIndex: 0, startMinutes: 1320, endMinutes: 1560 };

    expect(calendarSegmentsForDay([sunday], [], 0)).toEqual([
      expect.objectContaining({ segmentKey: 'shift-sun:start', renderStart: 1320, renderEnd: 1440 }),
    ]);
    expect(calendarSegmentsForDay([sunday], [], 1)).toEqual([
      expect.objectContaining({ segmentKey: 'shift-sun:spill', renderStart: 0, renderEnd: 120 }),
    ]);
  });
});
