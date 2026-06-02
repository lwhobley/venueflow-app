import { useConvexAuth } from 'convex/react';
import { useAuthStore, type AuthState } from './auth-store';

export function useAuthenticatedSession() {
  const hydrated = useAuthStore((state: AuthState) => state.hydrated);
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const auth = useConvexAuth();
  const isReady = hydrated && Boolean(user) && auth.isAuthenticated;

  return {
    hydrated,
    user,
    venue,
    isAuthenticated: auth.isAuthenticated,
    isAuthLoading: auth.isLoading,
    isReady,
  };
}
