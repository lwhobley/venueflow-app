import { View } from 'react-native';
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
    router.push('/billing');
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
      <Card style={{ backgroundColor: colors.surface, marginBottom: spacing.md }}>
        <Card.Content style={{ gap: 6 }}>
          <Text variant="headlineSmall">Profile</Text>
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

      {canViewBilling ? (
        <Button mode="outlined" textColor={colors.primary} onPress={onOpenBilling} style={{ marginBottom: spacing.sm }}>
          Billing
        </Button>
      ) : null}

      <Button mode="outlined" textColor={colors.primary} onPress={onLogout}>
        Sign out
      </Button>
    </View>
  );
}