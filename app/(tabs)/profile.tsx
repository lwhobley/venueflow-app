import { Alert, Platform, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Text } from 'react-native-paper';
import { useMutation } from 'convex/react';
import { useAuthActions } from '@convex-dev/auth/react';
import { api } from '../../convex/_generated/api';
import { colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { useAuthenticatedSession } from '../../lib/auth-readiness';

export default function ProfileScreen() {
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const clearSession = useAuthStore((state: AuthState) => state.clearSession);
  const { canManage, canManageBilling: canViewBilling } = useAuthenticatedSession();
  const { signOut } = useAuthActions();
  const deleteAccount = useMutation(api.app.deleteMyAccount);

  const onLogout = async () => {
    clearSession();
    router.replace('/sign-in');
  };

  const onOpenStaff = () => {
    router.push('/(tabs)/staff');
  };

  const onOpenBilling = () => {
    router.push(Platform.OS === 'web' ? '/billing' : '/billing/paywall');
  };

  const onDeleteAccount = () => {
    Alert.alert(
      'Delete account',
      'This permanently deletes your profile and all personal data from Venue Wrangler. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete permanently',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAccount({});
              clearSession();
              try { await signOut(); } catch { /* already signed out */ }
              router.replace('/sign-in');
            } catch (e) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Could not delete account. Try again.');
            }
          },
        },
      ],
    );
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

      <Button mode="outlined" textColor={colors.primary} onPress={onLogout} style={{ marginBottom: spacing.sm }}>
        Sign out
      </Button>

      <Button mode="text" textColor={colors.danger} onPress={onDeleteAccount}>
        Delete account
      </Button>
    </ScrollView>
  );
}
