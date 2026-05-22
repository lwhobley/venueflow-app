import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, SegmentedButtons, Text } from 'react-native-paper';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
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

function RequestQueue({ venueId }: { venueId: Id<'venues'> }) {
  const queueQuery = useQuery(api.app.listStaffRequests, { venueId });
  const reviewRequest = useMutation(api.app.reviewStaffRequest);
  const queue = useMemo(() => (queueQuery ?? []) as StaffRequest[], [queueQuery]);

  return (
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
                  <Button compact mode="contained" buttonColor={colors.primary} onPress={() => void reviewRequest({ requestId: request._id as Id<'staffRequests'>, status: 'approved' })}>Approve</Button>
                  <Button compact mode="outlined" textColor={colors.danger} onPress={() => void reviewRequest({ requestId: request._id as Id<'staffRequests'>, status: 'denied' })}>Deny</Button>
                </View>
              ) : null}
            </View>
          ))
        )}
      </Card.Content>
    </Card>
  );
}

export default function ScheduleScreen() {
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const role = user?.role ?? 'staff';
  const canManage = role === 'admin' || role === 'owner' || role === 'manager';

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
