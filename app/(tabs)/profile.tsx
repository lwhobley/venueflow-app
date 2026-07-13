import { Alert, Platform, ScrollView, View } from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { Button, Card, Text } from 'react-native-paper';
import { useMutation, useQuery } from '../../lib/railway-hooks';
import { useAuthActions } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import { colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { useAuthenticatedSession } from '../../lib/auth-readiness';
import { canManageBilling, canManageVenue } from '../../lib/permissions';

export default function ProfileScreen() {
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const clearSession = useAuthStore((state: AuthState) => state.clearSession);
  const { isReady } = useAuthenticatedSession();
  const me = useQuery(api.app.getMe, isReady ? {} : 'skip');
  const serverRole = me?.profile.role ?? null;
  const allAccess = me?.profile.allAccess ?? false;
  const canManage = Boolean(serverRole && canManageVenue(serverRole, allAccess));
  const canViewBilling = Boolean(serverRole && canManageBilling(serverRole, allAccess));
  const { signOut } = useAuthActions();
  const deleteAccount = useMutation(api.app.deleteMyAccount);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const onLogout = async () => {
    clearSession();
    router.replace('/(auth)/welcome');
  };

  const onOpenStaff = () => {
    router.push('/(tabs)/staff');
  };

  const onOpenBilling = () => {
    router.push(Platform.OS === 'web' ? '/billing' : '/billing/paywall');
  };

  const onDeleteAccount = async () => {
    setDeleting(true);
    try {
      await deleteAccount({});
      clearSession();
      try { await signOut(); } catch { /* already signed out */ }
      router.replace('/(auth)/welcome');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not delete account. Try again.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
      <Card style={{ backgroundColor: colors.surface, marginBottom: spacing.md, borderRadius: 16 }}>
        <Card.Content style={{ gap: 6 }}>
          <Text variant="headlineSmall" style={{ fontWeight: '700' }}>Profile</Text>
          <Text>{user?.full_name}</Text>
          <Text style={{ color: colors.muted }}>{user?.email}</Text>
          <Text style={{ color: colors.muted }}>{user?.job_title}</Text>
          <Text style={{ color: colors.muted }}>{venue?.name ?? 'Individual account'}</Text>
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

      <Button mode="outlined" textColor={colors.primary} icon="notebook-outline" onPress={() => router.push('/logbook')} style={{ marginBottom: spacing.sm }}>
        Shift logbook
      </Button>

      <Button mode="outlined" textColor={colors.primary} icon="clipboard-check-outline" onPress={() => router.push('/checklist')} style={{ marginBottom: spacing.sm }}>
        Opening/closing checklist
      </Button>

      <Button mode="outlined" textColor={colors.primary} icon="help-circle-outline" onPress={() => router.push('/help')} style={{ marginBottom: spacing.sm }}>
        Help & feature guide
      </Button>

      <Button mode="outlined" textColor={colors.primary} onPress={onLogout} style={{ marginBottom: spacing.sm }}>
        Sign out
      </Button>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16, marginTop: spacing.md }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '800', color: colors.danger }}>Account deletion</Text>
          <Text style={{ color: colors.muted }}>
            Permanently delete your Venue Wrangler account, profile, availability, push tokens, and sign-in credentials. Assigned shifts are released back to the venue before deletion.
          </Text>
          {!confirmDelete ? (
            <Button mode="outlined" textColor={colors.danger} icon="delete-outline" onPress={() => setConfirmDelete(true)}>
              Start account deletion
            </Button>
          ) : (
            <View style={{ gap: spacing.sm }}>
              <Text style={{ color: colors.danger, fontWeight: '700' }}>
                This cannot be undone. You will be signed out after deletion is complete.
              </Text>
              <Button mode="contained" buttonColor={colors.danger} icon="delete-forever-outline" loading={deleting} disabled={deleting} onPress={() => void onDeleteAccount()}>
                Permanently delete my account
              </Button>
              <Button mode="text" textColor={colors.primary} disabled={deleting} onPress={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </View>
          )}
        </Card.Content>
      </Card>
    </ScrollView>
  );
}
