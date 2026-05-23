import { useState } from 'react';
import { Linking, View } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';
import { router } from 'expo-router';
import { useAction, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';

export default function BillingScreen() {
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const billing = useQuery(api.app.getMyVenueBilling, user && venue?.id ? {} : 'skip');
  const createCheckout = useAction(api.billing.createStripeCheckoutSession);
  const createPortal = useAction(api.billing.createStripeBillingPortalSession);
  const [loading, setLoading] = useState<'checkout' | 'portal' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trialDaysLeft = billing ? Math.max(0, Math.ceil((billing.trialEndsAt - Date.now()) / (1000 * 60 * 60 * 24))) : 7;
  const canManageBilling = user?.role === 'admin' || user?.role === 'owner';

  const openStripe = async (kind: 'checkout' | 'portal') => {
    setLoading(kind);
    setError(null);
    try {
      const session = kind === 'checkout' ? await createCheckout({}) : await createPortal({});
      await Linking.openURL(session.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to open Stripe billing.');
    } finally {
      setLoading(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
      <Card style={{ backgroundColor: colors.surface }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="headlineSmall">Billing</Text>
          <Text style={{ color: colors.muted }}>{venue?.name ?? 'No venue selected'}</Text>
          <Text style={{ color: colors.muted }}>Plans: $149/month up to 15 users, $249 up to 30, $399 up to 50</Text>
          <Text style={{ color: colors.muted }}>Status: {billing?.status ?? 'trialing'}</Text>
          <Text style={{ color: colors.muted }}>{trialDaysLeft} days left in trial</Text>
          <Text style={{ color: colors.muted }}>Stripe manages checkout, renewals, payment methods, invoices, and cancellations.</Text>
          <Text style={{ color: colors.muted }}>Logged in as {user?.email ?? 'unknown'}</Text>
          {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
          {canManageBilling ? (
            <>
              <Button mode="contained" buttonColor={colors.primary} loading={loading === 'checkout'} onPress={() => void openStripe('checkout')}>
                Subscribe with Stripe
              </Button>
              <Button mode="outlined" textColor={colors.primary} loading={loading === 'portal'} onPress={() => void openStripe('portal')}>
                Manage billing portal
              </Button>
            </>
          ) : (
            <Text style={{ color: colors.muted }}>Only venue owners and admins can manage billing.</Text>
          )}
          <Button mode="contained" buttonColor={colors.primary} onPress={() => router.push('/(tabs)/profile')}>
            Back to profile
          </Button>
        </Card.Content>
      </Card>
    </View>
  );
}
