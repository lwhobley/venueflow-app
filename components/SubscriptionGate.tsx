import { useEffect } from 'react';
import { Platform } from 'react-native';
import { router, useSegments } from 'expo-router';
import { useQuery } from 'convex/react';
import { useA0Purchases } from '../lib/a0-purchases-stub';
import { api } from '../convex/_generated/api';
import { useAuthStore, type AuthState } from '../lib/auth-store';
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
  const me = useQuery(api.app.getMe, hydrated && user ? {} : 'skip');
  const billing = useQuery(api.app.getMyVenueBilling, me?.venue?._id ? {} : 'skip');
  const { isPremium } = useA0Purchases();
  const route = `/${segments.join('/')}`;
  const blocked = billing ? blockedStatuses.has(billing.status) && !isPremium : false;
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