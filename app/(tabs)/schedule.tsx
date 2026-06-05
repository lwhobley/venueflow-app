import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, SegmentedButtons, Snackbar, Text } from 'react-native-paper';
import { useMutation as useRQMutation, useQuery as useRQQuery, useQueryClient } from '@tanstack/react-query';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { useAuthenticatedSession } from '../../lib/auth-readiness';
import { useApiClient } from '../../lib/api-client';
import { ManagerCalendar } from '../../components/schedule/ManagerCalendar';
import { MyShifts } from '../../components/schedule/MyShifts';
import { AvailabilityEditor } from '../../components/schedule/AvailabilityEditor';
import { BlackoutManager } from '../../components/schedule/BlackoutManager';

type StaffRequest = {
  _id: string;
  title: string;
  kind: 'add_shift' | 'drop_shift' | 'time_off' | 'availability';
  status: 'pending' | 'approved' | 'denied' | 'cancelled';
  details: string;
};

type SwapRow = {
  _id: Id<'shiftSwaps'>;
  status: string;
  requesterName: string;
  targetName: string;
  requesterShift: string;
  targetShift: string | null;
};

function RequestQueue({ venueId }: { venueId: Id<'venues'> }) {
  const request = useApiClient();
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);

  // Staff requests — REST
  const { data: queueData } = useRQQuery<StaffRequest[]>({
    queryKey: ['staff-requests'],
    queryFn: async () => (await request('GET', '/v1/staff-requests')) as StaffRequest[],
  });
  const queue = queueData ?? [];

  const reviewRequestMutation = useRQMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      request('PATCH', `/v1/staff-requests/${id}`, { status }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['staff-requests'] }),
  });

  // Shift swaps — still on Convex (no NestJS endpoint yet)
  const swapsQuery = useQuery(api.scheduling.listShiftSwaps, { venueId });
  const reviewSwap = useMutation(api.scheduling.reviewShiftSwap);
  const swaps = useMemo(() => (swapsQuery ?? []) as SwapRow[], [swapsQuery]);

  const safe = async (action: () => Promise<unknown>, ok?: string) => {
    try {
      await action();
      if (ok) setToast(ok);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Action failed.');
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
                  <Button compact mode="contained" buttonColor={colors.primary} onPress={() => void safe(() => reviewSwap({ swapId: sw._id, approve: true }), 'Swap approved.')}>Approve</Button>
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
            queue.map((req) => (
              <View key={req._id} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 8 }}>
                <Text style={{ fontWeight: '700' }}>{req.title}</Text>
                <Text style={{ color: colors.muted }}>{req.kind.replace('_', ' ')} · {req.status}</Text>
                <Text>{req.details}</Text>
                {req.status === 'pending' ? (
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    <Button compact mode="contained" buttonColor={colors.primary} onPress={() => void safe(() => reviewRequestMutation.mutateAsync({ id: req._id, status: 'approved' }), 'Request approved.')}>Approve</Button>
                    <Button compact mode="outlined" textColor={colors.danger} onPress={() => void safe(() => reviewRequestMutation.mutateAsync({ id: req._id, status: 'denied' }), 'Request denied.')}>Deny</Button>
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

export default function ScheduleScreen() {
  const venue = useAuthStore((state: AuthState) => state.venue);
  const { isReady, canManage } = useAuthenticatedSession();
  const [managerTab, setManagerTab] = useState<'calendar' | 'requests' | 'blackouts'>('calendar');
  const [staffTab, setStaffTab] = useState<'shifts' | 'availability'>('shifts');

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
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
            onValueChange={(v) => setManagerTab(v as 'calendar' | 'requests' | 'blackouts')}
            buttons={[
              { value: 'calendar', label: 'Calendar' },
              { value: 'requests', label: 'Requests' },
              { value: 'blackouts', label: 'Blackouts' },
            ]}
          />
          {managerTab === 'calendar' ? (
            <ManagerCalendar venueId={venue.id} />
          ) : managerTab === 'requests' ? (
            <RequestQueue venueId={venue.id} />
          ) : (
            <BlackoutManager venueId={venue.id} />
          )}
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
          {staffTab === 'shifts' ? <MyShifts /> : <AvailabilityEditor />}
        </>
      )}
    </ScrollView>
  );
}
