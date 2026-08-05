import { Redirect } from 'expo-router';

// Availability is now handled by the unavailable-days request inside Schedule.
export default function AvailabilityScreen() {
  return <Redirect href="/(tabs)/schedule" />;
}
