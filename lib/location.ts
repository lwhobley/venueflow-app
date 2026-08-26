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
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.BestForNavigation,
    });

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy ?? 999,
      mocked: Boolean(position.mocked),
    };
  } catch (error: any) {
    if (error instanceof LocationPermissionDeniedError || error instanceof LocationServicesDisabledError) {
      throw error;
    }
    throw new LocationUnavailableError(error?.message ?? undefined);
  }
}
