import { Platform, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Text } from 'react-native-paper';
import { useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import { useA0Purchases } from '../lib/a0-purchases-stub';
import { getTrialState } from '../lib/trial';
import { colors, spacing } from '../lib/theme';
import { config } from '../lib/config';
import { useAuthenticatedSession } from '../lib/auth-readiness';
import { isAllAccessAccount } from '../lib/permissions';

// Wraps premium-only features (Integrations, CRM). These are locked during the
// free trial and after it expires — the user must upgrade to use them. When
// billing is disabled (local/dev builds) the feature is always unlocked.
export function PremiumFeatureGate({ feature, children }: { feature: string; children: React.ReactNode }) {
  const { isReady, user } = useAuthenticatedSession();
  const me = useQuery(api.app.getMe, isReady ? {} : 'skip');
  const { isPremium, isLoading } = useA0Purchases();
  const allAccess = isAllAccessAccount(me?.profile.email ?? user?.email);

  if (!config.billingEnabled || allAccess || isPremium) {
    return <>{children}</>;
  }
  // Avoid flashing the upsell while entitlement is still resolving.
  if (isLoading || me === undefined) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  const trial = getTrialState(me?.profile.trialEndsAt ?? null);
  const headline = trial.active
    ? `${feature} is a premium feature`
    : 'Your free trial has ended';
  const body = trial.active
    ? `You have ${trial.daysLeft} day${trial.daysLeft === 1 ? '' : 's'} left in your free trial. Upgrade now to unlock ${feature}.`
    : `Upgrade to a paid plan to unlock ${feature} and the rest of Venue Wrangler.`;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, flexGrow: 1, justifyContent: 'center' }}>
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm, alignItems: 'center' }}>
          <Text variant="headlineSmall" style={{ fontWeight: '800', color: colors.primary, textAlign: 'center' }}>{headline}</Text>
          <Text style={{ color: colors.muted, textAlign: 'center' }}>{body}</Text>
          <Button
            mode="contained"
            buttonColor={colors.primary}
            icon="lock-open-variant"
            style={{ marginTop: spacing.sm }}
            onPress={() => router.push(Platform.OS === 'web' ? '/billing' : '/billing/paywall')}
          >
            Upgrade now
          </Button>
        </Card.Content>
      </Card>
    </ScrollView>
  );
}
