import { useCallback, useState } from 'react';
import { Alert, FlatList, SafeAreaView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { ActivityIndicator, Button, Card, Divider, Text } from 'react-native-paper';
import { useQuery as useRQQuery, useMutation as useRQMutation, useQueryClient } from '@tanstack/react-query';
import { appApi } from '../lib/api-client';
import { spacing } from '../lib/theme';
import { useAuthStore, type AuthState } from '../lib/auth-store';

const colors = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  primary: '#2F7D46',
  text: '#1F241E',
  muted: '#6F766B',
  border: '#E8E2D8',
  danger: '#B85047',
  buttonText: '#FFFFFF',
};

type JoinRequest = {
  id: string;
  venueId: string;
  venueName: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  status: string;
  createdAt: number;
};

export default function JoinRequestsScreen() {
  const token = useAuthStore((s: AuthState) => s.token);
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useRQQuery({
    queryKey: ['manager-join-requests'],
    queryFn: () => appApi.listManagerJoinRequests(),
    enabled: Boolean(token),
  });

  const [processingId, setProcessingId] = useState<string | null>(null);

  const handleApprove = useCallback(async (req: JoinRequest) => {
    setProcessingId(req.id);
    try {
      await appApi.approveJoinRequest(req.id);
      await queryClient.invalidateQueries({ queryKey: ['manager-join-requests'] });
    } catch (e) {
      Alert.alert('Could not approve', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setProcessingId(null);
    }
  }, [queryClient]);

  const handleReject = useCallback((req: JoinRequest) => {
    Alert.alert(
      'Decline request',
      `Decline ${req.userName ?? req.userEmail ?? 'this person'}'s request to join ${req.venueName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: async () => {
            setProcessingId(req.id);
            try {
              await appApi.rejectJoinRequest(req.id);
              await queryClient.invalidateQueries({ queryKey: ['manager-join-requests'] });
            } catch (e) {
              Alert.alert('Could not decline', e instanceof Error ? e.message : 'Try again.');
            } finally {
              setProcessingId(null);
            }
          },
        },
      ],
    );
  }, [queryClient]);

  const requests: JoinRequest[] = data?.requests ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <Button
          icon="arrow-left"
          textColor={colors.primary}
          onPress={() => router.back()}
          compact
        >
          Back
        </Button>
        <Text variant="titleLarge" style={{ color: colors.text, fontWeight: '700', flex: 1 }}>
          Join Requests
        </Text>
        <Button icon="refresh" textColor={colors.muted} onPress={() => void refetch()} compact>
          {''}
        </Button>
      </View>

      {isLoading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      {!isLoading && error && (
        <View style={styles.center}>
          <Text style={{ color: colors.danger }}>Failed to load requests.</Text>
          <Button mode="text" textColor={colors.primary} onPress={() => void refetch()}>
            Retry
          </Button>
        </View>
      )}

      {!isLoading && !error && requests.length === 0 && (
        <View style={styles.center}>
          <Text variant="titleMedium" style={{ color: colors.text }}>
            No pending requests
          </Text>
          <Text variant="bodySmall" style={{ color: colors.muted, marginTop: 4 }}>
            Join requests from employees will appear here.
          </Text>
        </View>
      )}

      {!isLoading && requests.length > 0 && (
        <FlatList
          data={requests}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          renderItem={({ item }) => {
            const isProcessing = processingId === item.id;
            const name = item.userName ?? item.userEmail ?? 'Unknown user';
            return (
              <Card style={styles.card}>
                <Card.Content style={{ gap: spacing.sm }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <View style={{ flex: 1 }}>
                      <Text variant="titleSmall" style={{ color: colors.text, fontWeight: '600' }}>
                        {name}
                      </Text>
                      {item.userEmail && item.userName ? (
                        <Text variant="bodySmall" style={{ color: colors.muted }}>
                          {item.userEmail}
                        </Text>
                      ) : null}
                      <Text variant="bodySmall" style={{ color: colors.muted }}>
                        {item.venueName}
                      </Text>
                      <Text variant="labelSmall" style={{ color: colors.muted }}>
                        {new Date(item.createdAt).toLocaleDateString()}
                      </Text>
                    </View>
                    {isProcessing && <ActivityIndicator size="small" color={colors.primary} />}
                  </View>
                  {!isProcessing && (
                    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                      <Button
                        mode="contained"
                        buttonColor={colors.primary}
                        textColor={colors.buttonText}
                        onPress={() => void handleApprove(item)}
                        style={{ flex: 1 }}
                        compact
                      >
                        Approve
                      </Button>
                      <Button
                        mode="outlined"
                        textColor={colors.danger}
                        onPress={() => handleReject(item)}
                        style={{ flex: 1, borderColor: colors.danger }}
                        compact
                      >
                        Decline
                      </Button>
                    </View>
                  )}
                </Card.Content>
              </Card>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E2D8',
    gap: spacing.sm,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E2D8',
  },
});
