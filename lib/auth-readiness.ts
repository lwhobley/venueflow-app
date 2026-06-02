import { useEffect, useRef } from 'react';
import { useConvexAuth, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import { useAuthStore, type AuthState } from './auth-store';
import { canManageBilling, canManageVenue } from './permissions';

export function useAuthenticatedSession() {
  const hydrated = useAuthStore((state: AuthState) => state.hydrated);
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const auth = useConvexAuth();
  const isReady = hydrated && Boolean(user) && auth.isAuthenticated;

  const me = useQuery(api.app.getMe, isReady ? {} : 'skip');

  const lastRole = useRef<string | null>(null);
  const lastAllAccess = useRef<boolean | null>(null);
  useEffect(() => {
    if (me?.profile) {
      lastRole.current = me.profile.role ?? null;
      lastAllAccess.current = me.profile.allAccess === true;
    }
  }, [me?.profile?.role, me?.profile?.allAccess]);

  const role = me?.profile.role ?? lastRole.current;
  const allAccess = me?.profile.allAccess ?? lastAllAccess.current ?? user?.all_access ?? false;
  const canManage = canManageVenue(role, allAccess);
  const canViewBilling = canManageBilling(role, allAccess);

  return {
    hydrated,
    user,
    venue,
    me,
    role,
    allAccess,
    canManage,
    canManageBilling: canViewBilling,
    isAuthenticated: auth.isAuthenticated,
    isAuthLoading: auth.isLoading,
    isReady,
  };
}
