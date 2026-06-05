import { useEffect, useRef } from 'react';
import { useConvexAuth } from 'convex/react';
import { useQuery as useRQQuery } from '@tanstack/react-query';
import { useAuthToken } from '@convex-dev/auth/react';
import { useAuthStore, type AuthState } from './auth-store';
import { canManageBilling, canManageVenue } from './permissions';
import { useApiClient } from './api-client';

type MeResponse = {
  user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    jobTitle: string;
    allAccess: boolean;
  } | null;
  venue: unknown;
};

export function useAuthenticatedSession() {
  const hydrated = useAuthStore((state: AuthState) => state.hydrated);
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const auth = useConvexAuth();
  const token = useAuthToken();
  const request = useApiClient();
  const isReady = hydrated && Boolean(user) && auth.isAuthenticated;

  const meQuery = useRQQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: async () => (await request('GET', '/v1/app/me')) as MeResponse,
    enabled: isReady && Boolean(token),
    staleTime: 30_000,
  });

  // Expose in the legacy { profile } shape that existing screens still read.
  const me = meQuery.data?.user
    ? { profile: { role: meQuery.data.user.role, allAccess: meQuery.data.user.allAccess } }
    : undefined;

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
