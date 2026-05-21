import { useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Card, Text } from 'react-native-paper';
import { useA0Purchases } from '../../lib/a0-purchases-stub';
import { colors, spacing } from '../../lib/theme';
import { config } from '../../lib/config';
import { useAuthStore, type AuthState } from '../../lib/auth-store';

const headlineByReason: Record<string, string> = {
  trial_expired: 'Your 14-day trial has ended',
  payment_failed: "Your payment didn't go through",
  cancelled: 'Your subscription has been cancelled',
  never_subscribed: 'Subscribe to access EnishVenueFlow',
};

export default function BillingLockedScreen() {
  const params = useLocalSearchParams<{ reason?: string }>();
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const reason = Array.isArray(params.reason) ? params.reason[0] : params.reason ?? 'never_subscribed';
  const canPay = user?.role === 'admin' || user?.role === 'owner';
  const { offerings, purchase, restore, isPremium, isLoading } = useA0Purchases();
  const [purchasing, setPurchasing] = useState(false);

  const packages = offerings?.current?.availablePackages ?? [];
  const primaryPackage = packages[0] ?? null;

  const onSubscribe = async () => {
    if (!primaryPackage) return;
    setPurchasing(true);
    try {
      await purchase(primaryPackage.identifier);
      router.replace('/(tabs)/profile');
    } finally {
      setPurchasing(false);
    }
  };

  const onRestore = async () => {
    setPurchasing(true);
    try {
      await restore();
      if (isPremium) {
        router.replace('/(tabs)/profile');
      }
    } finally {
      setPurchasing(false);
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
                <Text variant="titleMedium">14-day free trial, then $49/month</Text>
                <Text style={{ color: colors.muted }}>Unlimited reservations, waitlist, floor plan, integrations, and staff.</Text>
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
                {packages.length > 0 ? (
                  <Button mode="contained" buttonColor={colors.primary} loading={purchasing || isLoading} onPress={onSubscribe}>
                    {primaryPackage ? `Subscribe — ${primaryPackage.product.priceString}` : 'Subscribe'}
                  </Button>
                ) : (
                  <Text style={{ color: colors.danger }}>
                    No active products are available yet. Sync monetization before charging customers.
                  </Text>
                )}
                <Button mode="outlined" textColor={colors.primary} loading={purchasing} onPress={onRestore}>
                  Restore purchases
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
            <Button mode="text" textColor={colors.primary} onPress={() => Linking.openURL('mailto:support@enishvenueflow.com')}>
              Need help? Contact support
            </Button>
          </Card.Content>
        </Card>
      </ScrollView>
    </View>
  );
}