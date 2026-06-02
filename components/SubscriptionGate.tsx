import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { router, useRootNavigationState, useSegments } from 'expo-router';
import { useAuthActions } from '@convex-dev/auth/react';
import { useConvexAuth, useQuery } from 'convex/react';
import { useA0Purchases } from '../lib/a0-purchases-stub';
import { api } from '../convex/_generated/api';
import { useAuthStore, type AuthState } from '../lib/auth-store';
import { config } from '../lib/config';
import { isAllAccessAccount } from '../lib/permissions';
import type { SubscriptionRequiredReason } from '../convex/billing/shared';

const blockedStatuses = new Set(['past_due', 'cancelled', 'expired', 'paused']);
const allowedBlockedRoutes = ['/billing/locked', '/settings/billing', '/settings/account', '/venues'];

function reasonFromStatus(status?: string | null): SubscriptionRequiredReason {
  if (status === 'past_due') return 'payment_failed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'expired') return 'trial_expired';
  return 'never_subscribed';
}

function isAllowedRoute(route: string) {
  return route.startsWith('/(auth)/') || allowedBlockedRoutes.some((allowed) => route.startsWith(allowed));
}

function isSubscriptionRequiredError(error: unknown): error is Error & { reason?: SubscriptionRequiredReason } {
  return error instanceof Error && (error.name === 'SubscriptionRequiredError' || error.message.includes('Subscription required'));
}

export function SubscriptionGate({ children }: { children?: unknown }) {
  const segments = useSegments();
  const rootNavigationState = useRootNavigationState();
  const { signOut } = useAuthActions();
  const hydrated = useAuthStore((state: AuthState) => state.hydrated);
  const user = useAuthStore((state: AuthState) => state.user);
  const setSession = useAuthStore((state: AuthState) => state.setSession);
  const clearSession = useAuthStore((state: AuthState) => state.clearSession);
  const staleSessionResetRef = useRef(false);
  // Convex auth settles asynchronously after the persisted session rehydrates.
  // Only query (and judge the profile "missing") once the token is actually
  // established — otherwise a fresh login races the token handshake, getMe
  // briefly returns null, and we sign the user out into an infinite login loop.
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const me = useQuery(api.app.getMe, hydrated && user && isAuthenticated ? {} : 'skip');
  const route = `/${segments.join('/')}`;
  const navigationReady = Boolean(rootNavigationState?.key);
  const authRoute = route.startsWith('/(auth)/');
  const signedOutProtectedRoute = hydrated && !user && !authRoute;
  const staleSignedOutSession = hydrated && Boolean(user) && !authLoading && !isAuthenticated;
  const profileMissing = hydrated && Boolean(user) && isAuthenticated && me === null;

  useEffect(() => {
    if (!user || me?.profile) {
      staleSessionResetRef.current = false;
    }
  }, [me?.profile, user]);

  useEffect(() => {
    if (!profileMissing || staleSessionResetRef.current) return undefined;

    const timeout = setTimeout(() => {
      staleSessionResetRef.current = true;
      clearSession();
      void signOut().catch(() => {
        // The persisted app session is already cleared; ignore auth cleanup failures.
      });
      if (navigationReady && !route.startsWith('/(auth)/')) {
        router.replace('/sign-in');
      }
    }, 800);

    return () => clearTimeout(timeout);
  }, [clearSession, navigationReady, profileMissing, route, signOut]);

  useEffect(() => {
    if (!navigationReady || !signedOutProtectedRoute) return;
    router.replace('/sign-in');
  }, [navigationReady, signedOutProtectedRoute]);

  useEffect(() => {
    if (!staleSignedOutSession || staleSessionResetRef.current) return undefined;

    const timeout = setTimeout(() => {
      staleSessionResetRef.current = true;
      clearSession();
      void signOut().catch(() => {
        // The persisted app session is already cleared; ignore auth cleanup failures.
      });
      if (navigationReady && !authRoute) {
        router.replace('/sign-in');
      }
    }, 800);

    return () => clearTimeout(timeout);
  }, [authRoute, clearSession, navigationReady, signOut, staleSignedOutSession]);

  // Keep the local session in sync with the server profile (role, name, venue)
  // so changes like an admin promotion reflect without re-login.
  useEffect(() => {
    if (!me?.profile || !user) return;
    const p = me.profile;
    const same =
      user.role === p.role &&
      user.full_name === p.fullName &&
      user.job_title === p.jobTitle &&
      user.venue_id === (p.venueId ?? null);
    if (same) return;
    setSession({
      user: { id: p._id, email: p.email, full_name: p.fullName, role: p.role, job_title: p.jobTitle, venue_id: p.venueId ?? null },
      venue: me.venue
        ? { id: me.venue._id, name: me.venue.name, latitude: me.venue.latitude, longitude: me.venue.longitude, geofence_radius_m: me.venue.geofenceRadiusM }
        : null,
    });
  }, [me, user, setSession]);
  const billing = useQuery(api.app.getMyVenueBilling, me?.venue?._id ? {} : 'skip');
  const { isPremium, isLoading: isPremiumLoading } = useA0Purchases();
  const allAccess = isAllAccessAccount(me?.profile.email ?? user?.email);
  // When billing is disabled for local/dev builds, never hard-lock users.
  const venueBlocked = config.billingEnabled && !allAccess && billing ? blockedStatuses.has(billing.status) && !isPremiumLoading && !isPremium : false;
  // Per-user trial: once a standalone account's 14-day trial expires, every
  // feature is locked until they upgrade. Venue members with an active/trialing
  // venue subscription are governed by the venue billing status above instead.
  const venueActive = billing ? billing.status === 'active' || billing.status === 'trialing' : false;
  const trialEndsAt = me?.profile?.trialEndsAt ?? null;
  const trialExpired = trialEndsAt != null && trialEndsAt <= Date.now();
  const trialBlocked = config.billingEnabled && !allAccess && trialExpired && !venueActive && !isPremiumLoading && !isPremium;
  const blocked = venueBlocked || trialBlocked;
  const reason = trialBlocked ? 'trial_expired' : reasonFromStatus(billing?.status ?? null);

  useEffect(() => {
    if (!hydrated || !user || !blocked) return;
    if (isAllowedRoute(route)) return;
    router.replace(`/billing/locked?reason=${reason}`);
  }, [blocked, hydrated, reason, route, user]);

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;

    const globalObject = globalThis as typeof globalThis & {
      addEventListener?: typeof globalThis.addEventListener;
      removeEventListener?: typeof globalThis.removeEventListener;
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const rejection = event.reason;
      if (!isSubscriptionRequiredError(rejection)) return;
      event.preventDefault();
      router.replace(`/billing/locked?reason=${rejection.reason ?? reason}`);
    };

    const handleError = (event: Event) => {
      const errorEvent = event as ErrorEvent;
      if (!isSubscriptionRequiredError(errorEvent.error)) return;
      event.preventDefault();
      router.replace(`/billing/locked?reason=${errorEvent.error.reason ?? reason}`);
    };

    globalObject.addEventListener?.('unhandledrejection', handleUnhandledRejection);
    globalObject.addEventListener?.('error', handleError);

    return () => {
      globalObject.removeEventListener?.('unhandledrejection', handleUnhandledRejection);
      globalObject.removeEventListener?.('error', handleError);
    };
  }, [reason]);

  // A logged-in user with no server profile (deleted account, removed from
  // tenant) must not see protected content during the ~800ms window before the
  // deferred signOut fires — render nothing until the session is torn down.
  if (profileMissing) return null;

  return children as never;
}
