import { Redirect } from 'expo-router';
import { useAuthStore, type AuthState } from '../lib/auth-store';

export default function Index() {
  const hydrated = useAuthStore((state: AuthState) => state.hydrated);
  const user = useAuthStore((state: AuthState) => state.user);

  if (!hydrated) {
    return null;
  }

  return <Redirect href={user ? '/(tabs)/home' : '/(auth)/welcome'} />;
}
