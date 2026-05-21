import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, Chip, Text, TextInput as PaperTextInput } from 'react-native-paper';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';

type ShiftKind = 'add_shift' | 'drop_shift' | 'time_off' | 'availability';
type ShiftStatus = 'scheduled' | 'open' | 'covered';

type ScheduleShift = {
  _id: string;
  dayIndex: number;
  dayLabel: string;
  startTime: string;
  endTime: string;
  memberName: string;
  jobTitle: string;
  station: string;
  status: ShiftStatus;
  notes?: string | null;
};

type StaffRequest = {
  _id: string;
  title: string;
  kind: ShiftKind;
  status: 'pending' | 'approved' | 'denied' | 'cancelled';
  details: string;
};

type AvailabilityDraft = {
  dayLabel: string;
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
  available: boolean;
};

type DayGroup = {
  dayLabel: string;
  shifts: ScheduleShift[];
};

const weekLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const availabilityLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export default function ScheduleScreen() {
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const role = user?.role ?? 'staff';
  const canManage = role === 'admin' || role === 'owner' || role === 'manager';
  const scheduleQuery = useQuery(api.app.getWeeklySchedule);
  const shifts = useMemo(() => (scheduleQuery ?? []) as ScheduleShift[], [scheduleQuery]);
  const requestData = useQuery(api.app.getMyHoursAndRequests, venue?.id ? { venueId: venue.id } : 'skip');
  const reviewQueueQuery = useQuery(api.app.listStaffRequests, venue?.id && canManage ? { venueId: venue.id } : 'skip');
  const reviewQueue = useMemo(() => (reviewQueueQuery ?? []) as StaffRequest[], [reviewQueueQuery]);
  const createRequest = useMutation(api.app.createStaffRequest);
  const reviewRequest = useMutation(api.app.reviewStaffRequest);
  const [requestKind, setRequestKind] = useState<ShiftKind>('add_shift');
  const [requestTitle, setRequestTitle] = useState('Need coverage for my shift');
  const [requestDetails, setRequestDetails] = useState('Please review this request.');
  const [requestedDate, setRequestedDate] = useState('');
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [selectedShiftId, setSelectedShiftId] = useState<string | undefined>(undefined);

  const openShiftCount = useMemo(() => shifts.filter((shift: ScheduleShift) => shift.status === 'open').length, [shifts]);
  const grouped = useMemo<DayGroup[]>(
    () =>
      weekLabels.map((dayLabel, dayIndex) => ({
        dayLabel,
        shifts: shifts.filter((shift: ScheduleShift) => shift.dayIndex === dayIndex),
      })),
    [shifts],
  );

  const availabilityDraft = useMemo<AvailabilityDraft[]>(
    () =>
      availabilityLabels.map((dayLabel, dayIndex) => ({
        dayLabel,
        dayIndex,
        startMinutes: 600,
        endMinutes: 1080,
        available: true,
      })),
    [],
  );

  const submitRequest = async () => {
    if (!venue?.id) return;
    await createRequest({
      venueId: venue.id,
      kind: requestKind,
      title: requestTitle,
      details: requestDetails,
      requestedForDate: requestedDate || undefined,
      requestedShiftId: selectedShiftId as Id<'scheduleShifts'> | undefined,
      requestedRangeStart: rangeStart || undefined,
      requestedRangeEnd: rangeEnd || undefined,
      availability: requestKind === 'availability' ? availabilityDraft.map((item: AvailabilityDraft) => ({ ...item })) : undefined,
    });
    setRequestedDate('');
    setRangeStart('');
    setRangeEnd('');
  };

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md }}>
      <View style={{ gap: 4 }}>
        <Text variant="headlineMedium" style={{ color: colors.primary, fontFamily: 'serif' }}>
          Weekly Schedule
        </Text>
        <Text style={{ color: colors.muted }}>
          {canManage
            ? 'Managers and admins can review the schedule, requests, and coverage.'
            : 'Staff can view the schedule, their hours, request changes, and submit availability.'}
        </Text>
      </View>

      {openShiftCount > 0 ? (
        <Card style={{ backgroundColor: '#F6E8E4' }}>
          <Card.Content style={{ gap: spacing.xs }}>
            <Text variant="titleMedium" style={{ color: colors.danger }}>
              Coverage needed
            </Text>
            <Text style={{ color: colors.charcoal }}>
              {openShiftCount} open shift{openShiftCount === 1 ? '' : 's'} still need to be picked up this week.
            </Text>
          </Card.Content>
        </Card>
      ) : null}

      <Card style={{ backgroundColor: colors.surface }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium">Your hours and requests</Text>
          {requestData ? (
            <>
              <Text>Hours worked: {requestData.hoursWorked}h</Text>
              <Text>Hours this week: {requestData.hoursThisWeek}h</Text>
              <Text style={{ color: colors.muted }}>{requestData.requests.length} request{requestData.requests.length === 1 ? '' : 's'} submitted</Text>
            </>
          ) : (
            <Text style={{ color: colors.muted }}>Load your hours and request history.</Text>
          )}
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium">Request shift changes</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(['add_shift', 'drop_shift', 'time_off', 'availability'] as ShiftKind[]).map((kind) => (
              <Chip key={kind} selected={requestKind === kind} onPress={() => setRequestKind(kind)}>
                {kind.replace('_', ' ')}
              </Chip>
            ))}
          </View>
          <PaperTextInput placeholder="Request title" value={requestTitle} onChangeText={setRequestTitle} mode="outlined" outlineStyle={{ borderColor: colors.border }} style={{ backgroundColor: colors.surface }} />
          <PaperTextInput placeholder="Details" value={requestDetails} onChangeText={setRequestDetails} mode="outlined" multiline outlineStyle={{ borderColor: colors.border }} style={{ minHeight: 90, backgroundColor: colors.surface }} />
          <PaperTextInput placeholder="Requested date (YYYY-MM-DD)" value={requestedDate} onChangeText={setRequestedDate} mode="outlined" outlineStyle={{ borderColor: colors.border }} style={{ backgroundColor: colors.surface }} />
          <PaperTextInput placeholder="Range start for time off / availability" value={rangeStart} onChangeText={setRangeStart} mode="outlined" outlineStyle={{ borderColor: colors.border }} style={{ backgroundColor: colors.surface }} />
          <PaperTextInput placeholder="Range end for time off / availability" value={rangeEnd} onChangeText={setRangeEnd} mode="outlined" outlineStyle={{ borderColor: colors.border }} style={{ backgroundColor: colors.surface }} />
          {shifts.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 4 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {shifts.slice(0, 8).map((shift: ScheduleShift) => (
                  <Chip key={shift._id} selected={selectedShiftId === shift._id} onPress={() => setSelectedShiftId(shift._id)}>
                    {shift.dayLabel} · {shift.jobTitle}
                  </Chip>
                ))}
              </View>
            </ScrollView>
          ) : null}
          <Button mode="contained" buttonColor={colors.primary} onPress={() => void submitRequest()}>
            Submit request
          </Button>
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium">Two-week availability</Text>
          <Text style={{ color: colors.muted }}>
            Staff can submit a two-week availability window for scheduling.
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {availabilityDraft.map((item: AvailabilityDraft) => (
              <Chip key={item.dayIndex} selected={item.available}>
                {item.dayLabel}
              </Chip>
            ))}
          </View>
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium">Weekly calendar</Text>
          {grouped.map(({ dayLabel, shifts: dayShifts }: DayGroup) => (
            <View key={dayLabel} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontWeight: '700' }}>{dayLabel}</Text>
                <Chip compact>{dayShifts.length} shift{dayShifts.length === 1 ? '' : 's'}</Chip>
              </View>
              {dayShifts.length === 0 ? (
                <Text style={{ color: colors.muted }}>No shifts scheduled.</Text>
              ) : (
                dayShifts.map((shift: ScheduleShift) => (
                  <View key={shift._id} style={{ padding: 12, borderRadius: 14, backgroundColor: shift.status === 'open' ? '#F6E8E4' : colors.cream, gap: 4 }}>
                    <Text style={{ fontWeight: '700' }}>
                      {shift.startTime} – {shift.endTime}
                    </Text>
                    <Text>{shift.memberName} · {shift.jobTitle}</Text>
                    <Text style={{ color: colors.muted }}>{shift.station}</Text>
                    <Chip compact selected={shift.status !== 'open'}>{shift.status === 'open' ? 'Needs coverage' : shift.status}</Chip>
                  </View>
                ))
              )}
            </View>
          ))}
        </Card.Content>
      </Card>

      {canManage ? (
        <Card style={{ backgroundColor: colors.surface }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleMedium">Request review queue</Text>
            {reviewQueue.length === 0 ? (
              <Text style={{ color: colors.muted }}>No pending requests.</Text>
            ) : (
              reviewQueue.map((request: StaffRequest) => (
                <View key={request._id} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 8 }}>
                  <Text style={{ fontWeight: '700' }}>{request.title}</Text>
                  <Text style={{ color: colors.muted }}>{request.kind.replace('_', ' ')} · {request.status}</Text>
                  <Text>{request.details}</Text>
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    <Button mode="contained" onPress={() => void reviewRequest({ requestId: request._id as Id<'staffRequests'>, status: 'approved' })}>Approve</Button>
                    <Button mode="outlined" onPress={() => void reviewRequest({ requestId: request._id as Id<'staffRequests'>, status: 'denied' })}>Deny</Button>
                  </View>
                </View>
              ))
            )}
          </Card.Content>
        </Card>
      ) : null}
    </ScrollView>
  );
}