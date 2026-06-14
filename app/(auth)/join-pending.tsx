import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Card, Text } from 'react-native-paper';
import { appApi } from '../../lib/api-client';
import { spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';

const colors = {
  background: '#FFFFFF',
  primary: '#2F7D46',
  text: '#1F241E',
  muted: '#6F766B',
  border: '#E8E2D8',
  danger: '#B85047',
  buttonText: '#FFFFFF',
};

type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'unknown';

export default function JoinPendingScreen() {
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

  const displayName = checkedVenueName || venueName || 'your workplace';

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
            <Text variant="headlineMedium" style={{ color: colors.text, fontWeight: '700', textAlign: 'center' }}>
              Waiting for approval
            </Text>
            <Text variant="bodyMedium" style={{ color: colors.muted, textAlign: 'center' }}>
              Your request to join{'\n'}
              <Text style={{ fontWeight: '700', color: colors.text }}>{displayName}</Text>
              {'\n'}has been submitted. A manager will review it shortly.
            </Text>
          </View>
          <Card style={styles.card}>
            <Card.Content style={{ gap: spacing.sm }}>
              <Text variant="bodySmall" style={{ color: colors.muted, textAlign: 'center' }}>
                You'll be notified once your request is approved or declined.
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
            Check status
          </Button>
          <Button
            mode="outlined"
            textColor={colors.primary}
            onPress={() => router.replace('/(auth)/workplace-search')}
          >
            Join a different workplace
          </Button>
        </>
      )}

      {status === 'approved' && (
        <>
          <View style={styles.iconCircle}>
            <Text style={{ fontSize: 36 }}>✅</Text>
          </View>
          <View style={{ gap: 6, alignItems: 'center' }}>
            <Text variant="headlineMedium" style={{ color: colors.primary, fontWeight: '700', textAlign: 'center' }}>
              You're in!
            </Text>
            <Text variant="bodyMedium" style={{ color: colors.muted, textAlign: 'center' }}>
              Your request to join {displayName} has been approved.
            </Text>
          </View>
          <Button
            mode="contained"
            buttonColor={colors.primary}
            textColor={colors.buttonText}
            onPress={() => router.replace('/(tabs)/home')}
          >
            Go to the app
          </Button>
        </>
      )}

      {status === 'rejected' && (
        <>
          <View style={styles.iconCircle}>
            <Text style={{ fontSize: 36 }}>❌</Text>
          </View>
          <View style={{ gap: 6, alignItems: 'center' }}>
            <Text variant="headlineMedium" style={{ color: colors.danger, fontWeight: '700', textAlign: 'center' }}>
              Request declined
            </Text>
            <Text variant="bodyMedium" style={{ color: colors.muted, textAlign: 'center' }}>
              Your request to join {displayName} was declined. Contact your manager if you think this is a mistake.
            </Text>
          </View>
          <Button
            mode="contained"
            buttonColor={colors.primary}
            textColor={colors.buttonText}
            onPress={() => router.replace('/(auth)/workplace-search')}
          >
            Search for another workplace
          </Button>
        </>
      )}

      {(status === 'cancelled' || status === 'unknown') && (
        <>
          <View style={{ gap: 6, alignItems: 'center' }}>
            <Text variant="headlineMedium" style={{ color: colors.text, fontWeight: '700', textAlign: 'center' }}>
              No active request
            </Text>
            <Text variant="bodyMedium" style={{ color: colors.muted, textAlign: 'center' }}>
              You don't have an active join request. Search for a workplace to submit one.
            </Text>
          </View>
          <Button
            mode="contained"
            buttonColor={colors.primary}
            textColor={colors.buttonText}
            onPress={() => router.replace('/(auth)/workplace-search')}
          >
            Find a workplace
          </Button>
        </>
      )}

      <Button
        mode="text"
        textColor={colors.muted}
        onPress={() => {
          clearSession();
          router.replace('/(auth)/sign-in');
        }}
      >
        Sign out
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
    backgroundColor: '#F0F7F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E8E2D8',
  },
});
