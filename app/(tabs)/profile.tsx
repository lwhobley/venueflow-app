import { Platform, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Text } from 'react-native-paper';
import { colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';

export default function ProfileScreen() {
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const clearSession = useAuthStore((state: AuthState) => state.clearSession);
  const canManage = user?.role === 'admin' || user?.role === 'owner' || user?.role === 'manager';
  const canViewBilling = user?.role === 'admin' || user?.role === 'owner';

  const onLogout = async () => {
    clearSession();
    router.replace('/(auth)/sign-in');
  };

  const onOpenStaff = () => {
    router.push('/(tabs)/staff');
  };

  const onOpenBilling = () => {
    // iOS/Android must use in-app purchases (App Store rules); web uses Stripe.
    router.push(Platform.OS === 'web' ? '/billing' : '/billing/paywall');
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
      <Card style={{ backgroundColor: colors.surface, marginBottom: spacing.md, borderRadius: 16 }}>
        <Card.Content style={{ gap: 6 }}>
          <Text variant="headlineSmall" style={{ fontWeight: '700' }}>Profile</Text>
          <Text>{user?.full_name}</Text>
          <Text style={{ color: colors.muted }}>{user?.email}</Text>
          <Text style={{ color: colors.muted }}>{user?.job_title}</Text>
          <Text style={{ color: colors.muted }}>{venue?.name ?? 'No venue assigned'}</Text>
        </Card.Content>
      </Card>

      {canManage ? (
        <Button mode="contained" buttonColor={colors.primary} onPress={onOpenStaff} style={{ marginBottom: spacing.sm }}>
          Manage staff
        </Button>
      ) : null}

      {canManage ? (
        <Button mode="outlined" textColor={colors.primary} icon="map-marker-radius" onPress={() => router.push('/venue/settings')} style={{ marginBottom: spacing.sm }}>
          Venue location & geofence
        </Button>
      ) : null}

      {canViewBilling ? (
        <Button mode="outlined" textColor={colors.primary} onPress={onOpenBilling} style={{ marginBottom: spacing.sm }}>
          Billing
        </Button>
      ) : null}

      <Button mode="outlined" textColor={colors.primary} onPress={onLogout}>
        Sign out
      </Button>
    </ScrollView>
  );
}