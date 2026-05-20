import { View } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';
import { router } from 'expo-router';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';

export default function BillingScreen() {
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const billing = useQuery(api.app.getMyVenueBilling, user && venue?.id ? {} : 'skip');

  const trialDaysLeft = billing ? Math.max(0, Math.ceil((billing.trialEndsAt - Date.now()) / (1000 * 60 * 60 * 24))) : 14;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
      <Card style={{ backgroundColor: colors.surface }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="headlineSmall">Billing</Text>
          <Text style={{ color: colors.muted }}>{venue?.name ?? 'No venue selected'}</Text>
          <Text style={{ color: colors.muted }}>Plan: $49/month per venue</Text>
          <Text style={{ color: colors.muted }}>Status: {billing?.status ?? 'trialing'}</Text>
          <Text style={{ color: colors.muted }}>{trialDaysLeft} days left in trial</Text>
          <Text style={{ color: colors.muted }}>14-day free trial starts automatically for new venues.</Text>
          <Text style={{ color: colors.muted }}>Logged in as {user?.email ?? 'unknown'}</Text>
          <Button mode="contained" buttonColor={colors.primary} onPress={() => router.push('/(tabs)/profile')}>
            Back to profile
          </Button>
        </Card.Content>
      </Card>
    </View>
  );
}