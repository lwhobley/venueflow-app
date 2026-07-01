import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, SegmentedButtons, Snackbar, Text } from 'react-native-paper';
import { ScreenErrorBoundary } from '../../components/ErrorBoundary';
import { AnimatedTab } from '../../components/AppCard';
import { useMutation, useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import type { Id } from '../../lib/ids';
import { colors, spacing } from '../../lib/theme';
import { useDesktopContentStyle } from '../../lib/responsive';
import { useVenueAuth } from '../../lib/useVenueAuth';
import { errorMessage } from '../../lib/format';
import { ManagerCalendar } from '../../components/schedule/ManagerCalendar';
import { MyShifts } from '../../components/schedule/MyShifts';
import { AvailabilityEditor } from '../../components/schedule/AvailabilityEditor';
import { BlackoutManager } from '../../components/schedule/BlackoutManager';
import { LaborForecastPanel } from '../../components/schedule/LaborForecastPanel';

type StaffRequest = {
  _id: string;
  title: string;
  kind: 'add_shift' | 'drop_shift' | 'time_off' | 'availability';
  status: 'pending' | 'approved' | 'denied' | 'cancelled';
  details: string;
};

type SwapRow = { _id: Id<'shiftSwaps'>; status: string; requesterName: string; targetName: string; requesterShift: string; targetShift: string | null };

function RequestQueue({ venueId }: { venueId: Id<'venues'> }) {
  const queueQuery = useQuery(api.app.listStaffRequests, { venueId });
  const reviewRequest = useMutation(api.app.reviewStaffRequest);
  const queue = useMemo(() => (queueQuery ?? []) as StaffRequest[], [queueQuery]);
  const swapsQuery = useQuery(api.scheduling.listShiftSwaps, { venueId });
  const reviewSwap = useMutation(api.scheduling.reviewShiftSwap);
  const swaps = useMemo(() => (swapsQuery ?? []) as SwapRow[], [swapsQuery]);
  const [toast, setToast] = useState<string | null>(null);

  const safe = async (action: () => Promise<unknown>, ok?: string) => {
    try {
      await action();
      if (ok) setToast(ok);
    } catch (e) {
      setToast(errorMessage(e, 'Action failed.'));
    }
  };

  return (
    <>
    <Card style={{ backgroundColor: colors.surface, borderRadius: 16, marginBottom: spacing.md }}>
      <Card.Content style={{ gap: spacing.sm }}>
        <Text variant="titleMedium" style={{ fontWeight: '700' }}>Shift swaps</Text>
        {swaps.length === 0 ? (
          <Text style={{ color: colors.muted }}>No swaps awaiting approval.</Text>
        ) : (
          swaps.map((sw) => (
            <View key={sw._id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 6 }}>
              <Text>{sw.requesterName} → {sw.targetName}</Text>
              <Text style={{ color: colors.muted }}>{sw.requesterShift}{sw.targetShift ? ` ⇄ ${sw.targetShift}` : ' (give-away)'} · {sw.status}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button compact mode="contained" buttonColor={colors.primary} onPress={() => void safe(() => reviewSwap({ swapId: sw._id, approve: true }), 'Swap approved.')} accessibilityLabel="Approve swap">Approve</Button>
                <Button compact mode="outlined" textColor={colors.danger} onPress={() => void safe(() => reviewSwap({ swapId: sw._id, approve: false }), 'Swap denied.')}>Deny</Button>
              </View>
            </View>
          ))
        )}
      </Card.Content>
    </Card>
    <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
      <Card.Content style={{ gap: spacing.sm }}>
        <Text variant="titleMedium" style={{ fontWeight: '700' }}>Request review queue</Text>
        {queue.length === 0 ? (
          <Text style={{ color: colors.muted }}>No pending requests.</Text>
        ) : (
          queue.map((request) => (
            <View key={request._id} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 8 }}>
              <Text style={{ fontWeight: '700' }}>{request.title}</Text>
              <Text style={{ color: colors.muted }}>{request.kind.replace('_', ' ')} · {request.status}</Text>
              <Text>{request.details}</Text>
              {request.status === 'pending' ? (
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  <Button compact mode="contained" buttonColor={colors.primary} onPress={() => void safe(() => reviewRequest({ requestId: request._id as Id<'staffRequests'>, status: 'approved' }), 'Request approved.')} accessibilityLabel="Approve request">Approve</Button>
                  <Button compact mode="outlined" textColor={colors.danger} onPress={() => void safe(() => reviewRequest({ requestId: request._id as Id<'staffRequests'>, status: 'denied' }), 'Request denied.')}>Deny</Button>
                </View>
              ) : null}
            </View>
          ))
        )}
      </Card.Content>
    </Card>
    <Snackbar visible={Boolean(toast)} onDismiss={() => setToast(null)} duration={3000} action={{ label: 'Dismiss', onPress: () => setToast(null) }}>
      {toast ?? ''}
    </Snackbar>
    </>
  );
}

export default function ScheduleScreenWrapper() {
  return <ScreenErrorBoundary><ScheduleScreen /></ScreenErrorBoundary>;
}

function ScheduleScreen() {
  const { venue, canManage } = useVenueAuth();

  const [managerTab, setManagerTab] = useState<'calendar' | 'forecast' | 'requests' | 'blackouts'>('calendar');
  const [staffTab, setStaffTab] = useState<'shifts' | 'availability'>('shifts');
  const contentContainerStyle = useDesktopContentStyle({ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={contentContainerStyle}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ gap: 4 }}>
        <Text variant="headlineMedium" style={{ color: colors.primary, fontWeight: '800' }}>
          Schedule
        </Text>
        <Text style={{ color: colors.muted }}>
          {canManage ? 'Build the schedule, assign staff, and review requests.' : 'See your shifts, pick up open ones, and set your availability.'}
        </Text>
      </View>

      {!venue?.id ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
          <Card.Content>
            <Text style={{ color: colors.muted }}>No venue assigned to your account yet.</Text>
          </Card.Content>
        </Card>
      ) : canManage ? (
        <>
          <SegmentedButtons
            value={managerTab}
            onValueChange={(v) => setManagerTab(v as 'calendar' | 'forecast' | 'requests' | 'blackouts')}
            buttons={[
              { value: 'calendar', label: 'Calendar' },
              { value: 'forecast', label: 'Forecast' },
              { value: 'requests', label: 'Requests' },
              { value: 'blackouts', label: 'Blackouts' },
            ]}
          />
          <AnimatedTab tabKey={managerTab}>
            {managerTab === 'calendar' ? (
              <ManagerCalendar venueId={venue.id} />
            ) : managerTab === 'forecast' ? (
              <LaborForecastPanel />
            ) : managerTab === 'requests' ? (
              <RequestQueue venueId={venue.id} />
            ) : (
              <BlackoutManager venueId={venue.id} />
            )}
          </AnimatedTab>
        </>
      ) : (
        <>
          <SegmentedButtons
            value={staffTab}
            onValueChange={(v) => setStaffTab(v as 'shifts' | 'availability')}
            buttons={[
              { value: 'shifts', label: 'My shifts' },
              { value: 'availability', label: 'Availability' },
            ]}
          />
          <AnimatedTab tabKey={staffTab}>
            {staffTab === 'shifts' ? <MyShifts /> : <AvailabilityEditor />}
          </AnimatedTab>
        </>
      )}
    </ScrollView>
  );
}
