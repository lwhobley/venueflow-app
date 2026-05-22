import { ScrollView, View } from 'react-native';
import { Button, Card, Chip, Text } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import { colors, spacing } from '../lib/theme';
import { useAuthStore, type AuthState } from '../lib/auth-store';

export default function HostStandScreen() {
  const router = useRouter();
  const venue = useAuthStore((state: AuthState) => state.venue);
  const floor = useQuery(api.floor.getActiveFloorPlan, venue?.id ? { venueId: venue.id } : 'skip');
  const stats = useQuery(api.floor.getFloorStats, venue?.id ? { venueId: venue.id } : 'skip');

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md }}>
      <View style={{ gap: 4 }}>
        <Text variant="headlineMedium" style={{ color: colors.primary, fontWeight: '800' }}>
          Host Stand
        </Text>
        <Text style={{ color: colors.muted }}>
          Tablet-sized live floor view for seating flow and current house load.
        </Text>
      </View>

      <Card style={{ backgroundColor: colors.surface }}>
        <Card.Content style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <Chip>Occupied: {stats?.occupiedCount ?? 0}</Chip>
          <Chip>Waitlist: {stats?.waitlistSize ?? 0}</Chip>
          <Chip>Dirty: {stats?.dirtyCount ?? 0}</Chip>
          <Chip>Available: {stats?.availableCount ?? 0}</Chip>
        </Card.Content>
      </Card>

      {floor ? (
        <Card style={{ backgroundColor: colors.surface }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleMedium">Quick seat map</Text>
            {floor.tables.slice(0, 10).map(({ table, state }) => (
              <View key={table._id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontWeight: '700' }}>{table.label}</Text>
                  <Chip compact>{state?.status ?? 'available'}</Chip>
                </View>
                <Text style={{ color: colors.muted }}>{table.section} · {table.seats} seats · party {state?.partySize ?? 0}</Text>
              </View>
            ))}
          </Card.Content>
        </Card>
      ) : null}

      <Button mode="contained" onPress={() => router.back()}>
        Back to floor
      </Button>
    </ScrollView>
  );
}
