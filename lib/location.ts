import * as Location from 'expo-location';
import { haversineMeters, isWithinGeofence } from './geo';
import type { GeofenceRule } from './geo';

export type CurrentLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  mocked: boolean;
};

// Re-export the pure helpers so existing imports from './location' keep working.
export { haversineMeters, isWithinGeofence };
export type { GeofenceRule };

export class LocationPermissionDeniedError extends Error {
  constructor(message = 'Location permission is required for geofenced clock-in.') {
    super(message);
    this.name = 'LocationPermissionDeniedError';
  }
}

export class LocationServicesDisabledError extends Error {
  constructor(message = 'Location services are disabled on your device. Please enable GPS in device settings.') {
    super(message);
    this.name = 'LocationServicesDisabledError';
  }
}

export class LocationUnavailableError extends Error {
  constructor(message = 'Unable to determine your precise location. Please check your GPS signal and try again.') {
    super(message);
    this.name = 'LocationUnavailableError';
  }
}

/**
 * How long to wait for a fresh fix before falling back to the cached one.
 * `BestForNavigation` asks for the highest precision available, which indoors
 * or in an urban canyon can take tens of seconds or never settle at all — and
 * the clock screen holds its loading state (and the punch button) for exactly
 * as long as this call takes.
 */
const FIX_TIMEOUT_MS = 12_000;

/** The server rejects anything coarser than 50 m, so a cached fix must clear it too. */
const MAX_USABLE_ACCURACY_M = 50;

/** Age beyond which a cached fix no longer evidences presence at the venue. */
const MAX_CACHED_FIX_AGE_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}

export async function getPreciseLocation(): Promise<CurrentLocation> {
  const isEnabled = await Location.hasServicesEnabledAsync().catch(() => true);
  if (!isEnabled) {
    throw new LocationServicesDisabledError();
  }

  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== Location.PermissionStatus.GRANTED) {
    throw new LocationPermissionDeniedError();
  }

  try {
    let position = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation }),
      FIX_TIMEOUT_MS,
    );

    // A recent cached fix still satisfies the server's accuracy rule, and is
    // far better than leaving the punch button disabled indefinitely.
    if (!position) {
      position = await Location.getLastKnownPositionAsync({
        maxAge: MAX_CACHED_FIX_AGE_MS,
        requiredAccuracy: MAX_USABLE_ACCURACY_M,
      }).catch(() => null);
    }

    if (!position) {
      throw new LocationUnavailableError(
        'Could not get a location fix in time. Step outside or near a window, then try again.',
      );
    }

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy ?? 999,
      mocked: Boolean(position.mocked),
    };
  } catch (error: any) {
    if (
      error instanceof LocationPermissionDeniedError
      || error instanceof LocationServicesDisabledError
      || error instanceof LocationUnavailableError
    ) {
      throw error;
    }
    throw new LocationUnavailableError(error?.message ?? undefined);
  }
}
