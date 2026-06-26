import { useState } from 'react';
import { Platform } from 'react-native';
import { appApi } from './api-client';

// Web billing actions: start a Stripe Checkout (subscribe) or open the Stripe
// customer portal (manage/cancel). Both ask the API for a URL and redirect the
// browser there. Paid access is shared across platforms because the Stripe
// webhook flips the same venue.subscriptionStatus the iOS app reads.
export function useWebBilling() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async (request: () => Promise<{ url: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await request();
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.location.assign(url);
      }
      return url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open Stripe. Please try again.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  return {
    busy,
    error,
    startCheckout: () => go(() => appApi.createStripeCheckout()),
    openPortal: () => go(() => appApi.createStripePortal()),
  };
}
