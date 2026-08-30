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
 * Accuracy at or below which a fix must have come from GNSS. Wi-Fi and cell
 * positioning do not reach this; satellite fixes routinely do.
 */
export const GNSS_ACCURACY_THRESHOLD_M = 10;

export type FixReplayVerdict = 'ok' | 'flag' | 'reject';

/**
 * Assess whether a punch's coordinates look replayed.
 *
 * IMPORTANT — this is a spoofing *signal*, not proof of location. lat/lng/mocked
 * are all supplied by the client, so a caller with a valid token can still post
 * the venue's coordinates from anywhere; only device attestation (App Attest /
 * Play Integrity) or a venue-side signal (BLE beacon, NFC tap, WiFi BSSID) can
 * actually establish presence. What this catches is the naive attack: hardcoding
 * the venue's coordinates and replaying them.
 *
 * Why an exact repeat is not enough on its own to reject:
 *
 *   A GNSS fix carries metre-level jitter in the low bits, so two independent
 *   satellite fixes never match exactly. Indoors — which is where a bar or
 *   restaurant clock-in happens — the device falls back to Wi-Fi/cell
 *   positioning, which returns the *registered* position of the surrounding
 *   access points. That value is deterministic: it repeats exactly, day after
 *   day, from the same spot, and its typical 20–40 m accuracy still passes the
 *   50 m geofence check. Rejecting on a single exact repeat therefore locked
 *   real employees out permanently, since the stored prior fix never changes
 *   while every punch is refused, and the message blamed the employee for a
 *   device behaviour they cannot influence.
 *
 * So: reject only when the fix claims GNSS-grade accuracy (where an exact repeat
 * is impossible), otherwise flag it for manager review and let the punch through.
 *
 * Compares only against fixes from *earlier days*: a clock-out minutes after a
 * clock-in can legitimately reuse the OS's cached fix.
 */
export function fixReplayVerdict(
  lat: number,
  lng: number,
  accuracy: number,
  priors: PriorFix[],
): FixReplayVerdict {
  const repeated = priors.some((prior) => prior.lat !== null && prior.lng !== null && prior.lat === lat && prior.lng === lng);
  if (!repeated) return 'ok';
  if (Number.isFinite(accuracy) && accuracy <= GNSS_ACCURACY_THRESHOLD_M) return 'reject';
  return 'flag';
}

/**
 * Throws only for a repeat that cannot be genuine. A repeat from a coarse
 * (Wi-Fi/cell) fix returns 'flag' instead, which the caller records on the
 * TimeEntry for the manager clock board rather than blocking the punch.
 */
export function assertFixNotReplayed(
  lat: number,
  lng: number,
  accuracy: number,
  priors: PriorFix[],
): FixReplayVerdict {
  const verdict = fixReplayVerdict(lat, lng, accuracy, priors);
  if (verdict === 'reject') {
    throw new BadRequestException(
      'This location reading is identical to an earlier punch and reports satellite-grade accuracy, which a live GPS fix cannot do. Turn location services off and on, then try again, or ask a manager to record this punch for you.',
    );
  }
  return verdict;
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
