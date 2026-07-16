import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Card, Text } from 'react-native-paper';
import { appApi } from '../../lib/api-client';
import { authCardStyle, authColors as colors, spacing, type } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { useI18n } from '../../lib/i18n';

type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'unknown';

export default function JoinPendingScreen() {
  const { t } = useI18n();
  const clearSession = useAuthStore((s: AuthState) => s.clearSession);
  const { venueName } = useLocalSearchParams<{ venueName?: string }>();

  const [status, setStatus] = useState<RequestStatus>('pending');
  const [checkedVenueName, setCheckedVenueName] = useState<string>(venueName ?? '');
  const [checking, setChecking] = useState(false);

  const checkStatus = useCallback(async () => {
    setChecking(true);
    try {
      const { requests } = await appApi.listMyJoinRequests();
      const latest = requests[0];
      if (!latest) {
        setStatus('unknown');
        return;
      }
      setStatus(latest.status as RequestStatus);
      setCheckedVenueName(latest.venueName);
      if (latest.status === 'approved') {
        // Force a session refresh so venue_id gets picked up.
        router.replace('/(tabs)/home');
      }
    } catch {
      // Ignore check failure; user can retry.
    } finally {
      setChecking(false);
    }
  }, []);

  // Auto-check on mount.
  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  const displayName = checkedVenueName || venueName || t('joinPending.defaultVenueName');

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        flexGrow: 1,
        padding: spacing.lg,
        justifyContent: 'center',
        gap: spacing.md,
      }}
    >
      {status === 'pending' && (
        <>
          <View style={styles.iconCircle}>
            <Text style={{ fontSize: 36 }}>⏳</Text>
          </View>
          <View style={{ gap: 6, alignItems: 'center' }}>
            <Text style={{ ...type.title, color: colors.text, textAlign: 'center' }}>
              {t('joinPending.pending.title')}
            </Text>
            <Text variant="bodyMedium" style={{ color: colors.muted, textAlign: 'center' }}>
              {t('joinPending.pending.bodyPrefix')}{'\n'}
              <Text style={{ fontWeight: '700', color: colors.text }}>{displayName}</Text>
              {'\n'}{t('joinPending.pending.bodySuffix')}
            </Text>
          </View>
          <Card style={styles.card}>
            <Card.Content style={{ gap: spacing.sm }}>
              <Text variant="bodySmall" style={{ color: colors.muted, textAlign: 'center' }}>
                {t('joinPending.pending.notifyNote')}
              </Text>
            </Card.Content>
          </Card>
          <Button
            mode="contained"
            buttonColor={colors.primary}
            textColor={colors.buttonText}
            loading={checking}
            onPress={() => void checkStatus()}
          >
            {t('joinPending.pending.checkStatusButton')}
          </Button>
          <Button
            mode="outlined"
            textColor={colors.primary}
            onPress={() => router.replace('/(auth)/workplace-search')}
          >
            {t('joinPending.pending.differentWorkplaceButton')}
          </Button>
        </>
      )}

      {status === 'approved' && (
        <>
          <View style={styles.iconCircle}>
            <Text style={{ fontSize: 36 }}>✅</Text>
          </View>
          <View style={{ gap: 6, alignItems: 'center' }}>
            <Text style={{ ...type.title, color: colors.primary, textAlign: 'center' }}>
              {t('joinPending.approved.title')}
            </Text>
            <Text variant="bodyMedium" style={{ color: colors.muted, textAlign: 'center' }}>
              {t('joinPending.approved.body', { venueName: displayName })}
            </Text>
          </View>
          <Button
            mode="contained"
            buttonColor={colors.primary}
            textColor={colors.buttonText}
            onPress={() => router.replace('/(tabs)/home')}
          >
            {t('joinPending.approved.goToAppButton')}
          </Button>
        </>
      )}

      {status === 'rejected' && (
        <>
          <View style={styles.iconCircle}>
            <Text style={{ fontSize: 36 }}>❌</Text>
          </View>
          <View style={{ gap: 6, alignItems: 'center' }}>
            <Text style={{ ...type.title, color: colors.danger, textAlign: 'center' }}>
              {t('joinPending.rejected.title')}
            </Text>
            <Text variant="bodyMedium" style={{ color: colors.muted, textAlign: 'center' }}>
              {t('joinPending.rejected.body', { venueName: displayName })}
            </Text>
          </View>
          <Button
            mode="contained"
            buttonColor={colors.primary}
            textColor={colors.buttonText}
            onPress={() => router.replace('/(auth)/workplace-search')}
          >
            {t('joinPending.rejected.searchAgainButton')}
          </Button>
        </>
      )}

      {(status === 'cancelled' || status === 'unknown') && (
        <>
          <View style={{ gap: 6, alignItems: 'center' }}>
            <Text style={{ ...type.title, color: colors.text, textAlign: 'center' }}>
              {t('joinPending.none.title')}
            </Text>
            <Text variant="bodyMedium" style={{ color: colors.muted, textAlign: 'center' }}>
              {t('joinPending.none.body')}
            </Text>
          </View>
          <Button
            mode="contained"
            buttonColor={colors.primary}
            textColor={colors.buttonText}
            onPress={() => router.replace('/(auth)/workplace-search')}
          >
            {t('joinPending.none.findWorkplaceButton')}
          </Button>
        </>
      )}

      <Button
        mode="text"
        textColor={colors.muted}
        onPress={() => {
          clearSession();
          router.replace('/(auth)/welcome');
        }}
      >
        {t('joinPending.signOut')}
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  iconCircle: {
    alignSelf: 'center',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.highlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    ...authCardStyle,
  },
});
