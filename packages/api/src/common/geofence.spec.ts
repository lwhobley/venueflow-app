import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { assertFixNotReplayed, assertWithinGeofence, fixReplayVerdict } from './geofence';

const venue = { latitude: 40.0, longitude: -73.0, geofenceRadiusM: 100 };

describe('assertWithinGeofence', () => {
  it('allows a punch at the venue coordinates', () => {
    expect(() => assertWithinGeofence(40.0, -73.0, 10, false, venue)).not.toThrow();
  });

  it('rejects mocked locations', () => {
    expect(() => assertWithinGeofence(40.0, -73.0, 10, true, venue)).toThrow(BadRequestException);
  });

  it('rejects poor accuracy (> 50m)', () => {
    expect(() => assertWithinGeofence(40.0, -73.0, 51, false, venue)).toThrow(BadRequestException);
  });

  it('rejects negative accuracy values', () => {
    expect(() => assertWithinGeofence(40.0, -73.0, -1, false, venue)).toThrow('Location accuracy is invalid.');
  });

  it('rejects coordinates outside latitude/longitude bounds', () => {
    expect(() => assertWithinGeofence(91, -73.0, 10, false, venue)).toThrow('Location coordinates are invalid.');
    expect(() => assertWithinGeofence(40.0, 181, 10, false, venue)).toThrow('Location coordinates are invalid.');
  });

  it('rejects the unconfigured venue coordinate sentinel', () => {
    expect(() => assertWithinGeofence(40.0, -73.0, 10, false, {
      latitude: 0, longitude: 0, geofenceRadiusM: 100,
    })).toThrow('location is not configured');
  });

  it('rejects a point outside the geofence radius', () => {
    // ~1.1km north of the venue, well beyond the 100m radius.
    expect(() => assertWithinGeofence(40.01, -73.0, 10, false, venue)).toThrow(BadRequestException);
  });

  it('allows a point just inside the radius', () => {
    // ~33m north (0.0003 deg lat ≈ 33m) — within 100m.
    expect(() => assertWithinGeofence(40.0003, -73.0, 10, false, venue)).not.toThrow();
  });
});

describe('fixReplayVerdict', () => {
  const GNSS = 6;   // satellite-grade accuracy
  const WIFI = 35;  // typical Wi-Fi/cell positioning accuracy, still inside the 50m gate

  it('allows a punch when there is no prior fix to compare against', () => {
    expect(fixReplayVerdict(40.0, -73.0, GNSS, [])).toBe('ok');
  });

  it('allows a punch when the prior entry stored no coordinates', () => {
    expect(fixReplayVerdict(40.0, -73.0, GNSS, [{ lat: null, lng: null }])).toBe('ok');
  });

  it('rejects an exact repeat that claims satellite-grade accuracy', () => {
    // Two independent GNSS fixes cannot match bit-for-bit.
    expect(fixReplayVerdict(40.0, -73.0, GNSS, [{ lat: 40.0, lng: -73.0 }])).toBe('reject');
  });

  it('flags rather than rejects an exact repeat from a coarse fix', () => {
    // Wi-Fi positioning returns the registered position of the surrounding
    // access points, which is deterministic and repeats exactly day after day.
    // Rejecting here locked real employees out of the clock permanently.
    expect(fixReplayVerdict(40.0, -73.0, WIFI, [{ lat: 40.0, lng: -73.0 }])).toBe('flag');
  });

  it('compares against several earlier fixes, not just the most recent', () => {
    // A device alternating between two access points would otherwise never
    // repeat the single latest fix and the signal would be lost.
    const priors = [{ lat: 41.0, lng: -74.0 }, { lat: 40.0, lng: -73.0 }];
    expect(fixReplayVerdict(40.0, -73.0, WIFI, priors)).toBe('flag');
  });

  it('allows a real fix that jitters in the low bits', () => {
    expect(fixReplayVerdict(40.00000012, -73.00000004, GNSS, [{ lat: 40.0, lng: -73.0 }])).toBe('ok');
  });

  it('does not treat a matching latitude alone as a replay', () => {
    expect(fixReplayVerdict(40.0, -73.5, GNSS, [{ lat: 40.0, lng: -73.0 }])).toBe('ok');
  });

  it('treats a non-finite accuracy as coarse rather than satellite-grade', () => {
    expect(fixReplayVerdict(40.0, -73.0, Number.NaN, [{ lat: 40.0, lng: -73.0 }])).toBe('flag');
  });
});

describe('assertFixNotReplayed', () => {
  it('throws only for the impossible-GNSS case', () => {
    expect(() => assertFixNotReplayed(40.0, -73.0, 6, [{ lat: 40.0, lng: -73.0 }])).toThrow(BadRequestException);
  });

  it('returns the flag verdict without blocking a coarse repeat', () => {
    expect(assertFixNotReplayed(40.0, -73.0, 35, [{ lat: 40.0, lng: -73.0 }])).toBe('flag');
  });

  it('returns ok for a novel fix', () => {
    expect(assertFixNotReplayed(40.5, -73.5, 35, [{ lat: 40.0, lng: -73.0 }])).toBe('ok');
  });
});
