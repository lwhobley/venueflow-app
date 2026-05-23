import { useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Card, Text } from 'react-native-paper';
import { useAction } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { colors, spacing } from '../../lib/theme';
import { config } from '../../lib/config';
import { useAuthStore, type AuthState } from '../../lib/auth-store';

const headlineByReason: Record<string, string> = {
  trial_expired: 'Your 3-day trial has ended',
  payment_failed: "Your payment didn't go through",
  cancelled: 'Your subscription has been cancelled',
  never_subscribed: 'Subscribe to access VenueFlow',
};

export default function BillingLockedScreen() {
  const params = useLocalSearchParams<{ reason?: string }>();
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const reason = Array.isArray(params.reason) ? params.reason[0] : params.reason ?? 'never_subscribed';
  const canPay = user?.role === 'admin' || user?.role === 'owner';
  const createCheckout = useAction(api.billing.createStripeCheckoutSession);
  const createPortal = useAction(api.billing.createStripeBillingPortalSession);
  const [loading, setLoading] = useState<'checkout' | 'portal' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openStripe = async (kind: 'checkout' | 'portal') => {
    setLoading(kind);
    setError(null);
    try {
      const session = kind === 'checkout' ? await createCheckout({}) : await createPortal({});
      await Linking.openURL(session.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open Stripe billing.');
    } finally {
      setLoading(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: spacing.lg, justifyContent: 'center' }}>
        <Card style={{ backgroundColor: colors.surface }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="headlineSmall">{headlineByReason[reason] ?? headlineByReason.never_subscribed}</Text>
            <Text style={{ color: colors.muted }}>
              Reactivate to keep your floor plan, reservations, waitlist, and integrations running.
            </Text>
            <Text style={{ color: colors.muted }}>Venue: {venue?.name ?? 'No venue selected'}</Text>
            <Text style={{ color: colors.muted }}>Signed in as {user?.email ?? 'unknown'}</Text>

            <Card style={{ backgroundColor: colors.background, marginTop: spacing.xs }}>
              <Card.Content style={{ gap: 4 }}>
                <Text variant="titleMedium">3-day free trial, then $49/month</Text>
                <Text style={{ color: colors.muted }}>Stripe manages subscriptions, renewals, invoices, and payment methods.</Text>
              </Card.Content>
            </Card>

            {!config.billingEnabled ? (
              <>
                <Text style={{ color: colors.muted }}>
                  Billing isn't enabled in this build, so there's nothing to pay for yet. You can continue using the app.
                </Text>
                <Button mode="contained" buttonColor={colors.primary} onPress={() => router.replace('/(tabs)/home')}>
                  Back to app
                </Button>
              </>
            ) : canPay ? (
              <>
                {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
                <Button mode="contained" buttonColor={colors.primary} loading={loading === 'checkout'} onPress={() => void openStripe('checkout')}>
                  Subscribe with Stripe
                </Button>
                <Button mode="outlined" textColor={colors.primary} loading={loading === 'portal'} onPress={() => void openStripe('portal')}>
                  Manage billing
                </Button>
              </>
            ) : (
              <Text style={{ color: colors.muted }}>
                This venue's subscription is inactive. Please ask the owner to reactivate at /settings/billing.
              </Text>
            )}

            <Button mode="text" textColor={colors.primary} onPress={() => router.replace('/(auth)/sign-in')}>
              Sign out
            </Button>
            <Button mode="text" textColor={colors.primary} onPress={() => Linking.openURL('mailto:support@venueflow.com')}>
              Need help? Contact support
            </Button>
          </Card.Content>
        </Card>
      </ScrollView>
    </View>
  );
}
