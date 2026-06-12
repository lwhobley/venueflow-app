import { Linking, View } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';
import { router } from 'expo-router';
import { useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import { colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { useAuthenticatedSession } from '../../lib/auth-readiness';
import { canManageBilling } from '../../lib/permissions';

const APPLE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';
const MONTHLY_PLAN_LABEL = '$29.99 / month';

export default function BillingScreen() {
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const { isReady } = useAuthenticatedSession();
  const me = useQuery(api.app.getMe, isReady ? {} : 'skip');
  const billing = useQuery(api.app.getMyVenueBilling, isReady && user && venue?.id ? {} : 'skip');

  const trialDaysLeft = billing ? Math.max(0, Math.ceil((billing.trialEndsAt - Date.now()) / (1000 * 60 * 60 * 24))) : 0;
  const canEditBilling = canManageBilling(me?.profile.role ?? user?.role, me?.profile.allAccess ?? user?.all_access);

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
          {billing ? <Text style={{ color: colors.muted }}>{trialDaysLeft} days left in trial</Text> : null}
          <Text style={{ color: colors.muted }}>The paid plan renews monthly and unlocks the full app for teams of 1-50 people.</Text>
          <Text style={{ color: colors.muted }}>Current plan: {billing ? MONTHLY_PLAN_LABEL : 'Not subscribed'}</Text>
          <Text style={{ color: colors.muted }}>Logged in as {user?.email ?? 'unknown'}</Text>

          <Button mode="contained" buttonColor={colors.primary} onPress={() => router.push('/billing/paywall')}>
            Start free trial
          </Button>
          <Button mode="outlined" textColor={colors.primary} onPress={() => void Linking.openURL(APPLE_SUBSCRIPTIONS_URL)}>
            Manage subscription
          </Button>
          <Button mode="text" textColor={colors.primary} onPress={() => router.push('/(tabs)/profile')}>
            Back to profile
          </Button>
        </Card.Content>
      </Card>
    </View>
  );
}
