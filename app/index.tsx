import { Redirect } from 'expo-router';
import { useAuthStore, type AuthState } from '../lib/auth-store';

export default function Index() {
  const hydrated = useAuthStore((state: AuthState) => state.hydrated);
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);

  if (!hydrated) {
    return null;
  }

  // A signed-in user must belong to a venue before reaching the app. New
  // accounts (and anyone removed from their venue) are sent to team-choice to
  // join an existing team or create their own.
  const href = !user ? '/(auth)/welcome' : !venue ? '/(auth)/team-choice' : '/(tabs)/home';
  return <Redirect href={href} />;
}
