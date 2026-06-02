import { useEffect, useRef } from 'react';
import { useConvexAuth, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import { useAuthStore, type AuthState } from './auth-store';
import { canManageVenue, canManageBilling } from './permissions';

export function useAuthenticatedSession() {
  const hydrated = useAuthStore((state: AuthState) => state.hydrated);
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const auth = useConvexAuth();
  const isReady = hydrated && Boolean(user) && auth.isAuthenticated;

  // Single source of truth for the server profile — deduplicated by Convex, so
  // many screens sharing this hook still issue one subscription.
  const me = useQuery(api.app.getMe, isReady ? {} : 'skip');

  // Hold the last SERVER-confirmed role/email so a transient token refresh
  // (isReady briefly flips false → me unmounts) doesn't collapse permissions
  // and flicker manager UI off. We never cache the persisted role, so a
  // stale/demoted role can never expose manager-only surfaces — gating stays
  // server-authoritative.
  const lastRole = useRef<string | null>(null);
  const lastEmail = useRef<string | null>(null);
  useEffect(() => {
    if (me?.profile) {
      lastRole.current = me.profile.role ?? null;
      lastEmail.current = me.profile.email ?? null;
    }
  }, [me?.profile?.role, me?.profile?.email]);

  const role = me?.profile.role ?? lastRole.current;
  // Email is stable identity (unlike role it can't be stale-elevated), so the
  // persisted value is a safe fallback and lets the all-access account unlock
  // before getMe resolves.
  const email = me?.profile.email ?? lastEmail.current ?? user?.email ?? null;
  const canManage = canManageVenue(role, email);
  const canViewBilling = canManageBilling(role, email);

  return {
    hydrated,
    user,
    venue,
    me,
    role,
    email,
    canManage,
    canManageBilling: canViewBilling,
    isAuthenticated: auth.isAuthenticated,
    isAuthLoading: auth.isLoading,
    isReady,
  };
}
