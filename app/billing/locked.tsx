import { useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Card, Text } from 'react-native-paper';
import { useAction } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { colors, spacing } from '../../lib/theme';
import { config } from '../../lib/config';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { canManageBilling } from '../../lib/permissions';

const plans = [
  { id: 'venueflow_starter_15_monthly', name: 'Starter', users: 'Up to 15 users', price: '$79.99' },
  { id: 'venueflow_growth_30_monthly', name: 'Pro', users: 'Up to 30 users', price: '$149.99' },
  { id: 'venueflow_pro_50_monthly', name: 'Enterprise', users: 'Up to 50 users', price: '$299.99' },
] as const;

type PlanId = (typeof plans)[number]['id'];

const headlineByReason: Record<string, string> = {
  trial_expired: 'Your 3-day trial has ended',
  trial_active: 'Upgrade to unlock this feature',
  payment_failed: "Your payment didn't go through",
  cancelled: 'Your subscription has been cancelled',
  never_subscribed: 'Subscribe to access Venue Wrangler',
};

export default function BillingLockedScreen() {
  const params = useLocalSearchParams<{ reason?: string }>();
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const reason = Array.isArray(params.reason) ? params.reason[0] : params.reason ?? 'never_subscribed';
  const canPay = canManageBilling(user?.role, user?.all_access);
  const createCheckout = useAction(api.billing.createStripeCheckoutSession);
  const createPortal = useAction(api.billing.createStripeBillingPortalSession);
  const [loading, setLoading] = useState<PlanId | 'portal' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openCheckout = async (planId: PlanId) => {
    setLoading(planId);
    setError(null);
    try {
      const session = await createCheckout({ planId });
      await Linking.openURL(session.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open Stripe billing.');
    } finally {
      setLoading(null);
    }
  };

  const openPortal = async () => {
    setLoading('portal');
    setError(null);
    try {
      const session = await createPortal({});
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

            <Text variant="titleMedium">3-day free trial</Text>
            <Text style={{ color: colors.muted }}>Choose the user tier that fits this venue. Subscriptions renew monthly and unlock the full app.</Text>

            {plans.map((plan) => (
              <View key={plan.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing.md, gap: spacing.xs, backgroundColor: colors.background }}>
                <Text variant="titleMedium" style={{ color: colors.primary, fontWeight: '800' }}>{plan.name}</Text>
                <Text style={{ color: colors.charcoal, fontSize: 26, fontWeight: '800' }}>{plan.price}<Text style={{ fontSize: 14 }}> / month</Text></Text>
                <Text style={{ color: colors.muted }}>{plan.users}</Text>
                <Text style={{ color: colors.muted }}>Scheduling, time clock, reservations, floor plan, bar stock, reports, and integrations.</Text>
                {config.billingEnabled && canPay ? (
                  <Button mode="contained" buttonColor={colors.primary} loading={loading === plan.id} onPress={() => void openCheckout(plan.id)}>
                    Choose {plan.name}
                  </Button>
                ) : null}
              </View>
            ))}

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
                <Button mode="outlined" textColor={colors.primary} loading={loading === 'portal'} onPress={() => void openPortal()}>
                  Manage billing
                </Button>
              </>
            ) : (
              <Text style={{ color: colors.muted }}>
                This venue's subscription is inactive. Please ask the owner to reactivate at /settings/billing.
              </Text>
            )}

            <Button mode="text" textColor={colors.primary} onPress={() => router.replace('/sign-in')}>
              Sign out
            </Button>
            <Button mode="text" textColor={colors.primary} onPress={() => Linking.openURL('mailto:support@venuewrangler.com')}>
              Need help? Contact support
            </Button>
          </Card.Content>
        </Card>
      </ScrollView>
    </View>
  );
}
