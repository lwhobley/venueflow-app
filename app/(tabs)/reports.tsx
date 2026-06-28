import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';
import { router } from 'expo-router';
import { useMutation, useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import { accents, colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { useAuthenticatedSession } from '../../lib/auth-readiness';
import { canManageVenue } from '../../lib/permissions';
import { DateRangeBar, useDateRange } from '../../components/DateRangeBar';
import { ProviderDropdown } from '../../components/ProviderDropdown';

// What we record as the export destination on /v1/payroll/record-export. The
// server stores `provider` as a free-form string today, so this list is purely
// the dropdown's choices — adding a vendor here is sufficient.
const payrollProviderOptions = [
  { value: 'gusto', label: 'Gusto' },
  { value: 'square_payroll', label: 'Square Payroll' },
  { value: 'toast_payroll', label: 'Toast Payroll' },
  { value: 'adp', label: 'ADP' },
  { value: 'paychex', label: 'Paychex' },
  { value: 'rippling', label: 'Rippling' },
  { value: 'paylocity', label: 'Paylocity' },
  { value: 'justworks', label: 'Justworks' },
  { value: 'onpay', label: 'OnPay' },
  { value: 'quickbooks_payroll', label: 'QuickBooks Payroll' },
  { value: 'wave_payroll', label: 'Wave Payroll' },
  { value: 'patriot', label: 'Patriot Software' },
  { value: 'homebase_payroll', label: 'Homebase Payroll' },
  { value: 'deel', label: 'Deel' },
  { value: 'csv', label: 'Other / generic CSV' },
] as const;
type PayrollProvider = (typeof payrollProviderOptions)[number]['value'];

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
  const { isReady, user } = useAuthenticatedSession();
  const me = useQuery(api.app.getMe, isReady ? {} : 'skip');
  const profileLoading = isReady && me === undefined;
  const canManage = Boolean(me && canManageVenue(me.profile.role, me.profile.allAccess));
  const [showTimeCsv, setShowTimeCsv] = useState(false);
  const [showPayrollCsv, setShowPayrollCsv] = useState(false);
  const [payrollProvider, setPayrollProvider] = useState<PayrollProvider>('gusto');
  const [showReservationCsv, setShowReservationCsv] = useState(false);
  const { selected: dateRange, setSelected: setDateRange, presets } = useDateRange('today');

  const insights = useQuery(api.app.getManagerInsights, isReady && canManage ? {} : 'skip') as Insight | null | undefined;
  const timeCsv = useQuery(api.app.exportTimeEntriesCsv, isReady && canManage && showTimeCsv ? {} : 'skip') as string | null | undefined;
  const reservationCsv = useQuery(api.reservations.exportReservationsCsv, isReady && canManage && showReservationCsv && venue?.id ? { venueId: venue.id } : 'skip') as string | null | undefined;
  const payroll = useQuery(api.payroll.getPayrollSummary, isReady && canManage && venue?.id ? { venueId: venue.id } : 'skip') as any;
  const payrollCsv = useQuery(api.payroll.exportPayrollCsv, isReady && canManage && showPayrollCsv && venue?.id ? { venueId: venue.id } : 'skip') as string | null | undefined;
  const recordPayrollExport = useMutation(api.payroll.recordPayrollExport);

  if (profileLoading) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={{ color: colors.muted }}>Loading…</Text>
      </ScrollView>
    );
  }
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

  const periodLabel = payroll?.periodStart && payroll?.periodEnd
    ? `${new Date(payroll.periodStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(payroll.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: spacing.sm }}>
        <View style={{ gap: 4 }}>
          <Text variant="headlineMedium" style={{ color: colors.primary, fontWeight: '800' }}>Reports</Text>
          <Text style={{ color: colors.muted }}>{venue?.name ?? 'Venue'} analytics and exports.</Text>
        </View>
        <DateRangeBar selected={dateRange} presets={presets} onSelect={setDateRange} />
      </View>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Integrations</Text>
          <Text style={{ color: colors.muted }}>Manage POS, reservation sync, payroll, and provider connections from the reporting hub.</Text>
          <Button compact mode="contained" buttonColor={colors.primary} icon="connection" onPress={() => router.push('/integrations')}>
            Open integrations
          </Button>
        </Card.Content>
      </Card>

      {/* Live metrics — always show current state */}
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>Live snapshot</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · right now
            </Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {metrics.map((metric) => (
              <Card key={metric.label} style={{ backgroundColor: metric.accent.bg, minWidth: '47%', flexGrow: 1, borderRadius: 14 }}>
                <Card.Content style={{ gap: 4 }}>
                  <Text style={{ color: metric.accent.fg, fontSize: 26, fontWeight: '800' }}>{metric.value}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{metric.label}</Text>
                </Card.Content>
              </Card>
            ))}
          </View>
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }}>
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>Time entries CSV</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>{dateRange.shortLabel}</Text>
          </View>
          <Button compact mode="outlined" textColor={colors.primary} onPress={() => setShowTimeCsv((value) => !value)}>
            {showTimeCsv ? 'Hide export' : 'Load export'}
          </Button>
          {showTimeCsv ? (
            <Text selectable style={{ color: colors.charcoal, fontFamily: 'monospace', fontSize: 12 }}>
              {timeCsv ?? 'Loading export...'}
            </Text>
          ) : null}
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <View style={{ flex: 1 }}>
              <Text variant="titleMedium" style={{ fontWeight: '700' }}>Payroll integration</Text>
              <Text style={{ color: colors.muted }}>
                {payroll ? `${payroll.totalHours}h · ${payroll.openEntryCount} open entries${periodLabel ? ` · ${periodLabel}` : ''}` : 'Loading payroll summary...'}
              </Text>
            </View>
            <Button
              compact
              mode="outlined"
              textColor={colors.primary}
              onPress={() => {
                if (venue?.id && payroll) {
                  void recordPayrollExport({ venueId: venue.id, provider: payrollProvider, periodStart: payroll.periodStart, periodEnd: payroll.periodEnd });
                }
              }}
            >
              Record export
            </Button>
          </View>
          <ProviderDropdown
            label="Payroll provider"
            value={payrollProvider}
            options={payrollProviderOptions}
            onChange={(next) => setPayrollProvider(next as PayrollProvider)}
          />
          <Button compact mode="outlined" textColor={colors.primary} onPress={() => setShowPayrollCsv((value) => !value)}>
            {showPayrollCsv ? 'Hide payroll export' : 'Load payroll export'}
          </Button>
          {showPayrollCsv ? (
            <Text selectable style={{ color: colors.charcoal, fontFamily: 'monospace', fontSize: 12 }}>
              {payrollCsv ?? 'Loading payroll export...'}
            </Text>
          ) : null}
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }}>
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>Reservations CSV</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>{dateRange.shortLabel}</Text>
          </View>
          <Button compact mode="outlined" textColor={colors.primary} onPress={() => setShowReservationCsv((value) => !value)}>
            {showReservationCsv ? 'Hide export' : 'Load export'}
          </Button>
          {showReservationCsv ? (
            <Text selectable style={{ color: colors.charcoal, fontFamily: 'monospace', fontSize: 12 }}>
              {reservationCsv ?? 'Loading export...'}
            </Text>
          ) : null}
        </Card.Content>
      </Card>
    </ScrollView>
  );
}
