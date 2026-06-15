import { Linking, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Card, Text } from 'react-native-paper';
import { colors, spacing } from '../../lib/theme';
import { config } from '../../lib/config';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { canManageBilling } from '../../lib/permissions';

const APPLE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';

const headlineByReason: Record<string, string> = {
  trial_expired: 'Your 14-day trial has ended',
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

            <Text variant="titleMedium">Subscribe to continue</Text>
            <Text style={{ color: colors.muted }}>
              $99.99/month for teams of 1-50 people keeps scheduling, the live floor, time clock, reservations, bar stock,
              reports, and integrations running across your whole team.
            </Text>

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
                <Button mode="contained" buttonColor={colors.primary} onPress={() => router.push('/billing/paywall')}>
                  Subscribe
                </Button>
                <Button mode="outlined" textColor={colors.primary} onPress={() => void Linking.openURL(APPLE_SUBSCRIPTIONS_URL)}>
                  Manage subscription
                </Button>
              </>
            ) : (
              <Text style={{ color: colors.muted }}>
                This venue's subscription is inactive. Please ask the owner to reactivate from Settings → Billing.
              </Text>
            )}

            <Button mode="text" textColor={colors.primary} onPress={() => router.replace('/(auth)/welcome')}>
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
