import { useEffect, useRef } from 'react';
import { useAuthStore, type AuthState } from './auth-store';
import { canManageBilling, canManageVenue } from './permissions';
import { useApiQuery } from './api-client';

export function useAuthenticatedSession() {
  const hydrated = useAuthStore((state: AuthState) => state.hydrated);
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const token = useAuthStore((state: AuthState) => state.token);
  const isReady = hydrated && Boolean(user) && Boolean(token);

  const { data: me, isLoading } = useApiQuery<any | null>(['app', 'me'], '/v1/app/me', isReady);

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
    isAuthenticated: Boolean(token),
    isAuthLoading: isLoading,
    isReady,
  };
}
