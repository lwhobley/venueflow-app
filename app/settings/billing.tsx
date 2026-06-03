import { useState } from 'react';
import { Linking, View } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';
import { router } from 'expo-router';
import { useAction, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { useAuthenticatedSession } from '../../lib/auth-readiness';
import { canManageBilling } from '../../lib/permissions';

const plans = [
  { id: 'venueflow_starter_15_monthly', name: 'Starter', users: 'Up to 15 users', price: '$79.99' },
  { id: 'venueflow_growth_30_monthly', name: 'Pro', users: 'Up to 30 users', price: '$149.99' },
  { id: 'venueflow_pro_50_monthly', name: 'Enterprise', users: 'Up to 50 users', price: '$299.99' },
] as const;

type PlanId = (typeof plans)[number]['id'];

export default function BillingScreen() {
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const { isReady } = useAuthenticatedSession();
  const me = useQuery(api.app.getMe, isReady ? {} : 'skip');
  const billing = useQuery(api.app.getMyVenueBilling, isReady && user && venue?.id ? {} : 'skip');
  const createCheckout = useAction(api.billing.createStripeCheckoutSession);
  const createPortal = useAction(api.billing.createStripeBillingPortalSession);
  const [loading, setLoading] = useState<PlanId | 'portal' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trialDaysLeft = billing ? Math.max(0, Math.ceil((billing.trialEndsAt - Date.now()) / (1000 * 60 * 60 * 24))) : 0;
  const canEditBilling = canManageBilling(me?.profile.role ?? user?.role, me?.profile.allAccess ?? user?.all_access);

  const openCheckout = async (planId: PlanId) => {
    setLoading(planId);
    setError(null);
    try {
      const session = await createCheckout({ planId });
      await Linking.openURL(session.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to open Stripe billing.');
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
      setError(e instanceof Error ? e.message : 'Unable to open Stripe billing.');
    } finally {
      setLoading(null);
    }
  };

  if (me === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
        <Text style={{ color: colors.muted }}>Loading billing access...</Text>
      </View>
    );
  }

  if (!canEditBilling) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
        <Text style={{ color: colors.muted }}>Billing is available to venue owners and admins.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
      <Card style={{ backgroundColor: colors.surface }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="headlineSmall">Billing</Text>
          <Text style={{ color: colors.muted }}>{venue?.name ?? 'No venue selected'}</Text>
          <Text style={{ color: colors.muted }}>3-day free trial. Choose the user tier that fits this venue.</Text>
          <Text style={{ color: colors.muted }}>Status: {billing?.status ?? 'Not configured'}</Text>
          {billing ? <Text style={{ color: colors.muted }}>{trialDaysLeft} days left in trial</Text> : null}
          <Text style={{ color: colors.muted }}>Subscriptions renew monthly and unlock the full app.</Text>
          <Text style={{ color: colors.muted }}>Current plan: {billing?.planId ?? 'Not subscribed'}</Text>
          <Text style={{ color: colors.muted }}>Logged in as {user?.email ?? 'unknown'}</Text>
          {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
          {plans.map((plan) => {
            const current = billing?.planId === plan.id;
            return (
              <View key={plan.id} style={{ borderWidth: 1, borderColor: current ? colors.primary : colors.border, borderRadius: 12, padding: spacing.md, gap: spacing.xs, backgroundColor: current ? colors.cream : colors.surface }}>
                <Text variant="titleMedium" style={{ color: colors.primary, fontWeight: '800' }}>{plan.name}</Text>
                <Text style={{ color: colors.charcoal, fontSize: 26, fontWeight: '800' }}>{plan.price}<Text style={{ fontSize: 14 }}> / month</Text></Text>
                <Text style={{ color: colors.muted }}>{plan.users}</Text>
                <Text style={{ color: colors.muted }}>Scheduling, time clock, reservations, floor plan, bar stock, reports, and integrations.</Text>
                {current ? <Text style={{ color: colors.success, fontWeight: '700' }}>Current plan</Text> : null}
                <Button mode="contained" buttonColor={colors.primary} loading={loading === plan.id} onPress={() => void openCheckout(plan.id)}>
                  Choose {plan.name}
                </Button>
              </View>
            );
          })}
          <Button mode="outlined" textColor={colors.primary} loading={loading === 'portal'} onPress={() => void openPortal()}>
            Manage billing portal
          </Button>
          <Button mode="contained" buttonColor={colors.primary} onPress={() => router.push('/(tabs)/profile')}>
            Back to profile
          </Button>
        </Card.Content>
      </Card>
    </View>
  );
}
