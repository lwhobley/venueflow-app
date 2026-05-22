import { ScrollView, View } from 'react-native';
import { Card, Text } from 'react-native-paper';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { accents, colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';

type Insight = {
  scheduledShifts: number;
  openShifts: number;
  activeClocks: number;
  lateOrMissedAlerts: number;
  activeReservations: number;
  upcomingReservations: number;
  pendingRequests: number;
};

export default function ReportsScreen() {
  const venue = useAuthStore((state: AuthState) => state.venue);
  const user = useAuthStore((state: AuthState) => state.user);
  const canManage = user?.role === 'admin' || user?.role === 'owner' || user?.role === 'manager';
  const insights = useQuery(api.app.getManagerInsights) as Insight | null | undefined;
  const timeCsv = useQuery(api.app.exportTimeEntriesCsv, canManage ? {} : 'skip') as string | null | undefined;
  const reservationCsv = useQuery(api.reservations.exportReservationsCsv, canManage && venue?.id ? { venueId: venue.id } : 'skip') as string | null | undefined;

  if (!canManage) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={{ color: colors.muted }}>Reports are available to managers and admins.</Text>
      </ScrollView>
    );
  }

  const metrics = [
    { label: 'Scheduled shifts', value: insights?.scheduledShifts ?? 0, accent: accents[0] },
    { label: 'Open shifts', value: insights?.openShifts ?? 0, accent: accents[1] },
    { label: 'Clocked in', value: insights?.activeClocks ?? 0, accent: accents[2] },
    { label: 'Clock alerts', value: insights?.lateOrMissedAlerts ?? 0, accent: accents[3] },
    { label: 'Active reservations', value: insights?.activeReservations ?? 0, accent: accents[4] },
    { label: 'Next 24h bookings', value: insights?.upcomingReservations ?? 0, accent: accents[0] },
    { label: 'Pending requests', value: insights?.pendingRequests ?? 0, accent: accents[1] },
  ];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ gap: 4 }}>
        <Text variant="headlineMedium" style={{ color: colors.primary, fontWeight: '800' }}>Reports</Text>
        <Text style={{ color: colors.muted }}>{venue?.name ?? 'Venue'} analytics and exports.</Text>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {metrics.map((metric) => (
          <Card key={metric.label} style={{ backgroundColor: metric.accent.bg, width: '48%', flexGrow: 1, borderRadius: 16 }}>
            <Card.Content style={{ gap: 4 }}>
              <Text style={{ color: metric.accent.fg, fontSize: 28, fontWeight: '800' }}>{metric.value}</Text>
              <Text style={{ color: colors.muted }}>{metric.label}</Text>
            </Card.Content>
          </Card>
        ))}
      </View>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Time entries CSV</Text>
          <Text selectable style={{ color: colors.charcoal, fontFamily: 'monospace', fontSize: 12 }}>
            {timeCsv ?? 'Loading export...'}
          </Text>
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Reservations CSV</Text>
          <Text selectable style={{ color: colors.charcoal, fontFamily: 'monospace', fontSize: 12 }}>
            {reservationCsv ?? 'Loading export...'}
          </Text>
        </Card.Content>
      </Card>
    </ScrollView>
  );
}
