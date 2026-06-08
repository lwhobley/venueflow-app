import { BadRequestException } from '@nestjs/common';
import { assertWithinGeofence } from './geofence';

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

  it('rejects a point outside the geofence radius', () => {
    // ~1.1km north of the venue, well beyond the 100m radius.
    expect(() => assertWithinGeofence(40.01, -73.0, 10, false, venue)).toThrow(BadRequestException);
  });

  it('allows a point just inside the radius', () => {
    // ~33m north (0.0003 deg lat ≈ 33m) — within 100m.
    expect(() => assertWithinGeofence(40.0003, -73.0, 10, false, venue)).not.toThrow();
  });
});
