import { BadRequestException } from '@nestjs/common';

type GeofenceVenue = {
  latitude: number;
  longitude: number;
  geofenceRadiusM: number;
};

/**
 * Asserts a clock punch is physically within the venue geofence.
 * Mirrors assertWithinGeofence in convex/app.ts (Haversine distance).
 *
 * @throws BadRequestException on mocked location, poor accuracy, or out-of-range.
 */
export function assertWithinGeofence(
  lat: number,
  lng: number,
  accuracy: number,
  mocked: boolean,
  venue: GeofenceVenue,
): void {
  if (mocked) {
    throw new BadRequestException('Mocked locations are not allowed.');
  }
  if (accuracy > 50) {
    throw new BadRequestException('Location accuracy must be 50m or better.');
  }
  const earthRadius = 6371000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLat = toRadians(lat - venue.latitude);
  const deltaLng = toRadians(lng - venue.longitude);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(venue.latitude)) * Math.cos(toRadians(lat)) * Math.sin(deltaLng / 2) ** 2;
  const distance = 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(a)));
  if (distance > venue.geofenceRadiusM) {
    throw new BadRequestException('You are outside the venue geofence.');
  }
}
