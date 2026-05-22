import { useEffect } from 'react';
import { Platform } from 'react-native';
import { router, useSegments } from 'expo-router';
import { useQuery } from 'convex/react';
import { useA0Purchases } from '../lib/a0-purchases-stub';
import { api } from '../convex/_generated/api';
import { useAuthStore, type AuthState } from '../lib/auth-store';
import { config } from '../lib/config';
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
  const hydrated = useAuthStore((state: AuthState) => state.hydrated);
  const user = useAuthStore((state: AuthState) => state.user);
  const setSession = useAuthStore((state: AuthState) => state.setSession);
  const me = useQuery(api.app.getMe, hydrated && user ? {} : 'skip');

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
  const { isPremium } = useA0Purchases();
  const route = `/${segments.join('/')}`;
  // When billing is disabled (no real IAP wired yet), never hard-lock users.
  const blocked = config.billingEnabled && billing ? blockedStatuses.has(billing.status) && !isPremium : false;
  const reason = reasonFromStatus(billing?.status ?? null);

  useEffect(() => {
    if (!hydrated || !user || !billing || !blocked) return;
    if (isAllowedRoute(route)) return;
    router.replace(`/billing/locked?reason=${reason}`);
  }, [billing, blocked, hydrated, reason, route, user]);

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

  return children as never;
}