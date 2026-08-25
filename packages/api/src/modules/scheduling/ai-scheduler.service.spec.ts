import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AiSchedulerService } from './ai-scheduler.service';

describe('AiSchedulerService.normalize', () => {
  const service = new AiSchedulerService();
  const validProfileIds = new Set(['staff-1', 'staff-2']);

  it('throws when the AI response is not an object with a shifts array', () => {
    expect(() => service.normalize(null, validProfileIds)).toThrow(BadRequestException);
    expect(() => service.normalize({}, validProfileIds)).toThrow(BadRequestException);
    expect(() => service.normalize({ shifts: 'nope' }, validProfileIds)).toThrow(BadRequestException);
  });

  it('accepts a well-formed shift and fills in defaults for optional fields', () => {
    const result = service.normalize(
      {
        shifts: [
          { dayIndex: 2, startMinutes: 480, endMinutes: 960, profileId: 'staff-1' },
        ],
      },
      validProfileIds,
    );

    expect(result.shifts).toEqual([
      {
        dayIndex: 2,
        startMinutes: 480,
        endMinutes: 960,
        jobTitle: 'Staff',
        station: 'Floor',
        profileId: 'staff-1',
        reason: 'AI-assigned to fill demand gap',
      },
    ]);
  });

  it('drops shifts with out-of-range or non-integer day/time fields', () => {
    const result = service.normalize(
      {
        shifts: [
          { dayIndex: 7, startMinutes: 0, endMinutes: 60 }, // dayIndex out of range
          { dayIndex: -1, startMinutes: 0, endMinutes: 60 }, // dayIndex negative
          { dayIndex: 1, startMinutes: 1.5, endMinutes: 60 }, // non-integer start
          { dayIndex: 1, startMinutes: 500, endMinutes: 4000 }, // duration too long
          { dayIndex: 1, startMinutes: 0, endMinutes: 0 }, // end equals start
          { dayIndex: 1, startMinutes: 0, endMinutes: 3000 }, // end past 2880
        ],
      },
      validProfileIds,
    );

    expect(result.shifts).toEqual([]);
  });

  it('nulls out a profileId that is not in the valid staff set', () => {
    const result = service.normalize(
      { shifts: [{ dayIndex: 0, startMinutes: 0, endMinutes: 60, profileId: 'ghost-staff' }] },
      validProfileIds,
    );

    expect(result.shifts[0].profileId).toBeNull();
    expect(result.shifts[0].reason).toBe('Open shift proposed to fill demand gap');
  });

  it('trims whitespace-only jobTitle/station/reason down to defaults', () => {
    const result = service.normalize(
      { shifts: [{ dayIndex: 0, startMinutes: 0, endMinutes: 60, jobTitle: '   ', station: '', reason: '  ' }] },
      validProfileIds,
    );

    expect(result.shifts[0].jobTitle).toBe('Staff');
    expect(result.shifts[0].station).toBe('Floor');
    expect(result.shifts[0].reason).toBe('Open shift proposed to fill demand gap');
  });

  it('caps the number of proposed shifts and silently drops the rest', () => {
    const shifts = Array.from({ length: 65 }, (_, i) => ({
      dayIndex: i % 7,
      startMinutes: 0,
      endMinutes: 60,
    }));

    const result = service.normalize({ shifts }, validProfileIds);

    expect(result.shifts).toHaveLength(60);
  });
});
