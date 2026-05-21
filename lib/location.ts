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

export async function getPreciseLocation(): Promise<CurrentLocation> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== Location.PermissionStatus.GRANTED) {
    throw new Error('Location permission is required for geofenced clock-in.');
  }

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.BestForNavigation,
  });

  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy ?? 999,
    mocked: Boolean(position.mocked),
  };
}
