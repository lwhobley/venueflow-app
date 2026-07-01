import { describe, expect, it, vi, afterEach } from 'vitest';
import { getTrialState } from './trial';

describe('getTrialState', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns inactive, not expired, 0 days when trialEndsAt is null', () => {
    expect(getTrialState(null)).toEqual({ active: false, expired: false, daysLeft: 0 });
  });

  it('returns inactive, not expired, 0 days when trialEndsAt is undefined', () => {
    expect(getTrialState(undefined)).toEqual({ active: false, expired: false, daysLeft: 0 });
  });

  it('returns active with correct daysLeft when trial has not expired', () => {
    const now = Date.now();
    const threeDaysFromNow = now + 3 * 24 * 60 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    const state = getTrialState(threeDaysFromNow);
    expect(state.active).toBe(true);
    expect(state.expired).toBe(false);
    expect(state.daysLeft).toBe(3);
  });

  it('returns active with 1 day left for a partial day remaining', () => {
    const now = Date.now();
    // 12 hours from now — should ceil to 1 day
    const halfDayFromNow = now + 12 * 60 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    const state = getTrialState(halfDayFromNow);
    expect(state.active).toBe(true);
    expect(state.expired).toBe(false);
    expect(state.daysLeft).toBe(1);
  });

  it('returns expired when trialEndsAt is in the past', () => {
    const now = Date.now();
    const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    const state = getTrialState(twoDaysAgo);
    expect(state.active).toBe(false);
    expect(state.expired).toBe(true);
    expect(state.daysLeft).toBe(0);
  });

  it('returns expired with 0 daysLeft when trialEndsAt equals now', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    const state = getTrialState(now);
    expect(state.active).toBe(false);
    expect(state.expired).toBe(true);
    expect(state.daysLeft).toBe(0);
  });

  it('returns active with 7 days left for a full week trial', () => {
    const now = Date.now();
    const sevenDaysFromNow = now + 7 * 24 * 60 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    const state = getTrialState(sevenDaysFromNow);
    expect(state.active).toBe(true);
    expect(state.expired).toBe(false);
    expect(state.daysLeft).toBe(7);
  });
});
