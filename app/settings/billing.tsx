import { useEffect, useMemo, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import { colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { useAuthenticatedSession } from '../../lib/auth-readiness';
import { useWebBilling } from '../../lib/web-billing';
import { canManageBilling } from '../../lib/permissions';
import { appApi } from '../../lib/api-client';

const isWeb = Platform.OS === 'web';

const APPLE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';
const MONTHLY_PLAN_LABEL = '$99.99 / month';

export default function BillingScreen() {
  const params = useLocalSearchParams<{ status?: string }>();
  const queryClient = useQueryClient();
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const { isReady } = useAuthenticatedSession();
  const me = useQuery(api.app.getMe, isReady ? {} : 'skip');
  const billing = useQuery(api.app.getMyVenueBilling, isReady && user && venue?.id ? {} : 'skip');
  const { startCheckout, openPortal, busy, error } = useWebBilling();
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const returnStatus = Array.isArray(params.status) ? params.status[0] : params.status;
  const stripeSuccessReturn = isWeb && returnStatus === 'success';

  // Trial state is account-scoped. Drive the CTA off that, not off
  // "never subscribed".
  const trialEndsAt: number | null = me?.profile?.trialEndsAt ?? null;
  const inTrial = trialEndsAt != null && trialEndsAt > Date.now();
  const isPaid = billing?.status === 'active';
  const trialDaysLeft = inTrial ? Math.max(0, Math.ceil((trialEndsAt - Date.now()) / (1000 * 60 * 60 * 24))) : 0;
  const upgradeLabel = inTrial ? 'Upgrade' : 'Subscribe';
  const canEditBilling = Boolean(me && canManageBilling(me.profile.role, me.profile.allAccess));

  const refreshBillingQueries = useMemo(
    () => async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['app.getMyVenueBilling'] }),
        queryClient.invalidateQueries({ queryKey: ['app.getMe'] }),
        queryClient.invalidateQueries({ queryKey: ['app', 'billing'] }),
        queryClient.invalidateQueries({ queryKey: ['app', 'me'] }),
      ]);
    },
    [queryClient],
  );

  useEffect(() => {
    if (!stripeSuccessReturn || !isReady || !user || !venue?.id) return undefined;
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 30;

    const check = async () => {
      attempts += 1;
      setConfirmingPayment(true);
      setConfirmMessage('Confirming your subscription with Stripe...');
      try {
        const latest = await appApi.getBilling();
        await refreshBillingQueries();
        if (cancelled) return;
        if (latest?.status === 'active') {
          setConfirmMessage('Subscription confirmed. Opening your workspace...');
          setTimeout(() => {
            if (!cancelled) router.replace('/(tabs)/home');
          }, 500);
          return;
        }
        if (attempts >= maxAttempts) {
          setConfirmingPayment(false);
          setConfirmMessage('Payment is still processing. Refresh this page in a moment if access has not updated.');
          return;
        }
        setTimeout(check, 2000);
      } catch {
        if (cancelled) return;
        if (attempts >= maxAttempts) {
          setConfirmingPayment(false);
          setConfirmMessage('Could not confirm the subscription yet. Refresh this page in a moment.');
          return;
        }
        setTimeout(check, 2000);
      }
    };

    void check();
    return () => {
      cancelled = true;
    };
  }, [isReady, refreshBillingQueries, stripeSuccessReturn, user, venue?.id]);

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
          <Text style={{ color: colors.muted }}>Status: {billing?.status ?? 'Not configured'}</Text>
          {inTrial ? <Text style={{ color: colors.muted }}>{trialDaysLeft} days left in intro access</Text> : null}
          <Text style={{ color: colors.muted }}>The paid plan renews monthly and unlocks the full app for teams of 1-50 people.</Text>
          <Text style={{ color: colors.muted }}>Current plan: {isPaid ? MONTHLY_PLAN_LABEL : inTrial ? 'Intro access' : 'Not subscribed'}</Text>
          <Text style={{ color: colors.muted }}>Logged in as {user?.email ?? 'unknown'}</Text>
          {confirmMessage ? <Text style={{ color: confirmingPayment ? colors.primary : colors.muted }}>{confirmMessage}</Text> : null}

          {!isPaid ? (
            <Button
              mode="contained"
              buttonColor={colors.primary}
              loading={isWeb && (busy || confirmingPayment)}
              disabled={confirmingPayment}
              onPress={() => (isWeb ? void startCheckout() : router.push('/billing/paywall'))}
            >
              {upgradeLabel}
            </Button>
          ) : null}
          <Button
            mode="outlined"
            textColor={colors.primary}
            loading={isWeb && busy}
            disabled={confirmingPayment}
            onPress={() => (isWeb ? void openPortal() : void Linking.openURL(APPLE_SUBSCRIPTIONS_URL))}
          >
            Manage subscription
          </Button>
          {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
          <Button mode="text" textColor={colors.primary} onPress={() => router.push('/(tabs)/profile')}>
            Back to profile
          </Button>
        </Card.Content>
      </Card>
    </View>
  );
}
