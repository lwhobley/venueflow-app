import { BadRequestException } from '@nestjs/common';

type GeofenceVenue = {
  latitude: number;
  longitude: number;
  geofenceRadiusM: number;
};

export type PriorFix = {
  lat: number | null;
  lng: number | null;
};

/**
 * Rejects a punch whose coordinates are bit-for-bit identical to a fix the same
 * profile submitted on an earlier day.
 *
 * IMPORTANT — this is a spoofing *signal*, not proof of location. lat/lng/mocked
 * are all supplied by the client, so a caller with a valid token can still post
 * the venue's coordinates from anywhere; only device attestation (App Attest /
 * Play Integrity) or a venue-side signal (BLE beacon, NFC tap, WiFi BSSID) can
 * actually establish presence. What this does catch is the common naive attack:
 * hardcoding the venue's coordinates and replaying them. A real GNSS fix carries
 * metre-level jitter in the low bits, so two independent fixes taken on
 * different days never match exactly.
 *
 * Deliberately compares only across *different days*: a clock-out minutes after
 * a clock-in can legitimately reuse the OS's cached fix and repeat exactly, so
 * same-day repeats are not treated as suspicious.
 */
export function assertFixNotReplayed(lat: number, lng: number, prior: PriorFix | null): void {
  if (!prior || prior.lat === null || prior.lng === null) return;
  if (lat === prior.lat && lng === prior.lng) {
    throw new BadRequestException(
      'This location reading is identical to a previous day\'s punch, which means it did not come from a live GPS fix. Turn location services on and try again, or ask a manager to record this punch for you.',
    );
  }
}

/**
 * Asserts a clock punch is physically within the venue geofence.
 * Uses Haversine distance.
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
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new BadRequestException('Location coordinates are invalid.');
  }
  if (!Number.isFinite(accuracy) || accuracy < 0) {
    throw new BadRequestException('Location accuracy is invalid.');
  }
  if (mocked) {
    throw new BadRequestException('Mocked locations are not allowed.');
  }
  if (accuracy > 50) {
    throw new BadRequestException('Location accuracy must be 50m or better.');
  }
  // A new venue defaults to (0,0) until a manager sets real coordinates. Left
  // unguarded, every clock punch would be evaluated against a geofence in the
  // Gulf of Guinea and fail with a confusing "outside the venue" error.
  if (venue.latitude === 0 && venue.longitude === 0) {
    throw new BadRequestException('This venue\'s location is not configured yet. Ask a manager to set it in Venue Settings.');
  }
  if (
    !Number.isFinite(venue.latitude) || venue.latitude < -90 || venue.latitude > 90
    || !Number.isFinite(venue.longitude) || venue.longitude < -180 || venue.longitude > 180
    || !Number.isFinite(venue.geofenceRadiusM) || venue.geofenceRadiusM <= 0
  ) {
    throw new BadRequestException('This venue\'s geofence configuration is invalid. Ask a manager to update Venue Settings.');
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
