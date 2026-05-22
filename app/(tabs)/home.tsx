import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, Chip, Text, TextInput } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { accents, colors, spacing } from '../../lib/theme';
import { Skeleton } from '../../components/Skeleton';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { usePushNotifications } from '../../lib/usePushNotifications';

type NotificationItem = {
  _id: Id<'notificationEvents'>;
  title: string;
  body: string;
  read: boolean;
};

export default function HomeScreen() {
  usePushNotifications();
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const dashboard = useQuery(api.app.getDashboard);
  const managerDashboard = useQuery(api.operations.getManagerDashboard, venue?.id ? { venueId: venue.id } : 'skip') as any;
  const notifications = useQuery(api.app.getNotifications);
  const markNotificationRead = useMutation(api.app.markNotificationRead);
  const upsertManagerGoal = useMutation(api.operations.upsertManagerGoal);
  const upsertVenueEvent = useMutation(api.operations.upsertVenueEvent);
  const loading = dashboard === undefined;

  const firstName = dashboard?.profile.fullName?.split(' ')[0] ?? user?.full_name?.split(' ')[0] ?? 'there';
  const role = dashboard?.profile.role ?? user?.role ?? 'staff';
  const venueName = dashboard?.venue.name ?? venue?.name ?? 'your venue';
  const openShifts = dashboard?.analytics.openShiftCount ?? 0;
  const canManage = role === 'admin' || role === 'owner' || role === 'manager';
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const [goalTitle, setGoalTitle] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [eventDate, setEventDate] = useState(todayKey);
  const [eventTime, setEventTime] = useState('18:00');
  const [eventNotes, setEventNotes] = useState('');

  const analytics = [
    { label: 'Team members', value: dashboard ? String(dashboard.analytics.teamCount) : '—', icon: 'account-group' },
    { label: 'Scheduled shifts', value: dashboard ? String(dashboard.analytics.scheduledCount) : '—', icon: 'calendar-week' },
    { label: 'Open shifts', value: dashboard ? String(dashboard.analytics.openShiftCount) : '—', icon: 'calendar-remove' },
    { label: 'Clocked in now', value: dashboard ? String(dashboard.analytics.clockedInCount) : '—', icon: 'clock-check' },
  ];

  const weeklyHighlights = dashboard
    ? dashboard.schedule.slice(0, 5).map((shift: any) => ({
        key: shift._id,
        day: shift.dayLabel,
        jobs: `${shift.memberName} · ${shift.jobTitle} · ${shift.startTime}–${shift.endTime}`,
        isOpen: shift.status === 'open',
      }))
    : [];

  const liveStaff = dashboard
    ? dashboard.activeClockEntries.map((person: any) => ({
        key: person._id,
        name: person.memberName,
        role: person.role,
        job: person.jobTitle,
        clockedIn: person.isOpen,
      }))
    : [];

  const recentNotifications = (notifications ?? []) as NotificationItem[];

  const addGoal = async () => {
    if (!venue?.id || !goalTitle.trim()) return;
    await upsertManagerGoal({ venueId: venue.id, title: goalTitle.trim(), period: 'day', targetDate: todayKey, status: 'open' });
    setGoalTitle('');
  };

  const addEvent = async () => {
    if (!venue?.id || !eventTitle.trim()) return;
    const startsAt = new Date(`${eventDate}T${eventTime}:00`).getTime();
    if (Number.isNaN(startsAt)) return;
    await upsertVenueEvent({ venueId: venue.id, title: eventTitle.trim(), startsAt, notes: eventNotes.trim() || undefined });
    setEventTitle('');
    setEventNotes('');
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ gap: 4 }}>
        <Text variant="headlineMedium" style={{ color: colors.primary, fontWeight: '800' }}>
          Dashboard
        </Text>
        <Text style={{ color: colors.muted }}>
          Good to see you, {firstName}. {role.toUpperCase()} · {venueName}
        </Text>
      </View>

      {openShifts > 0 ? (
        <Card style={{ backgroundColor: accents[1].bg, borderRadius: 16 }}>
          <Card.Content style={{ gap: spacing.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <MaterialCommunityIcons name="alert-circle-outline" size={22} color={accents[1].fg} />
              <Text variant="titleMedium" style={{ color: accents[1].fg, fontWeight: '700' }}>
                Coverage alert
              </Text>
            </View>
            <Text style={{ color: colors.charcoal }}>
              {openShifts} open shift{openShifts === 1 ? '' : 's'} need coverage this week.
            </Text>
          </Card.Content>
        </Card>
      ) : null}

      {canManage ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
              <Text variant="titleMedium" style={{ fontWeight: '700' }}>Manager command center</Text>
              <Chip compact>{managerDashboard?.totalReservations ?? 0} recent reservations</Chip>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              <Chip compact>{managerDashboard?.todayReservations ?? 0} today</Chip>
              <Chip compact>{managerDashboard?.vipOrLargeReservations?.length ?? 0} VIP / large</Chip>
              <Chip compact>{managerDashboard?.events?.length ?? 0} events this week</Chip>
            </View>
            <TextInput label="Manager goal for today" value={goalTitle} onChangeText={setGoalTitle} mode="outlined" style={{ backgroundColor: colors.surface }} />
            <Button compact mode="contained" buttonColor={colors.primary} onPress={() => void addGoal()}>Add goal</Button>
            {(managerDashboard?.goals ?? []).slice(0, 4).map((goal: any) => (
              <View key={goal._id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
                <Text style={{ fontWeight: '700' }}>{goal.title}</Text>
                <Text style={{ color: colors.muted }}>{goal.period} · {goal.targetDate} · {goal.status}</Text>
              </View>
            ))}
          </Card.Content>
        </Card>
      ) : null}

      {canManage ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>Upcoming events</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TextInput label="Event title" value={eventTitle} onChangeText={setEventTitle} mode="outlined" style={{ flex: 1, backgroundColor: colors.surface }} />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TextInput label="Date" value={eventDate} onChangeText={setEventDate} mode="outlined" style={{ flex: 1, backgroundColor: colors.surface }} />
              <TextInput label="Time" value={eventTime} onChangeText={setEventTime} mode="outlined" style={{ flex: 1, backgroundColor: colors.surface }} />
            </View>
            <TextInput label="Event notes" value={eventNotes} onChangeText={setEventNotes} mode="outlined" style={{ backgroundColor: colors.surface }} />
            <Button compact mode="contained" buttonColor={colors.primary} onPress={() => void addEvent()}>Add event</Button>
            {(managerDashboard?.events ?? []).length === 0 ? (
              <Text style={{ color: colors.muted }}>No upcoming events this week.</Text>
            ) : (
              managerDashboard.events.map((event: any) => (
                <View key={event._id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: 2 }}>
                  <Text style={{ fontWeight: '700' }}>{event.title}</Text>
                  <Text style={{ color: colors.muted }}>
                    {new Date(event.startsAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    {event.expectedGuests ? ` · ${event.expectedGuests} guests` : ''}
                  </Text>
                  {event.notes ? <Text style={{ color: colors.charcoal }}>{event.notes}</Text> : null}
                  {event.reservationNotes ? <Text style={{ color: colors.muted }}>Reservation: {event.reservationNotes}</Text> : null}
                </View>
              ))
            )}
          </Card.Content>
        </Card>
      ) : null}

      {canManage && (managerDashboard?.vipOrLargeReservations ?? []).length > 0 ? (
        <Card style={{ backgroundColor: accents[5].bg, borderRadius: 16 }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleMedium" style={{ color: accents[5].fg, fontWeight: '700' }}>VIP and large reservations</Text>
            {managerDashboard.vipOrLargeReservations.map((reservation: any) => (
              <View key={reservation._id} style={{ gap: 2 }}>
                <Text style={{ fontWeight: '700' }}>{reservation.guestName} · party of {reservation.partySize}</Text>
                <Text style={{ color: colors.muted }}>{new Date(reservation.reservationTime).toLocaleString()}</Text>
                {reservation.notes ? <Text style={{ color: colors.charcoal }}>{reservation.notes}</Text> : null}
              </View>
            ))}
          </Card.Content>
        </Card>
      ) : null}

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>Notifications</Text>
            <Chip compact>{recentNotifications.filter((item) => !item.read).length} unread</Chip>
          </View>
          {recentNotifications.length === 0 ? (
            <Text style={{ color: colors.muted }}>No notifications yet.</Text>
          ) : (
            recentNotifications.slice(0, 4).map((item) => (
              <View key={item._id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 4 }}>
                <Text style={{ fontWeight: item.read ? '600' : '800' }}>{item.title}</Text>
                <Text style={{ color: colors.muted }}>{item.body}</Text>
                {!item.read ? (
                  <Chip compact onPress={() => void markNotificationRead({ notificationId: item._id })}>
                    Mark read
                  </Chip>
                ) : null}
              </View>
            ))
          )}
        </Card.Content>
      </Card>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {analytics.map((item: any, i: number) => {
          const accent = accents[i % accents.length];
          return (
            <Card key={item.label} style={{ backgroundColor: accent.bg, width: '48%', flexGrow: 1, borderRadius: 16 }}>
              <Card.Content style={{ gap: spacing.sm }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <MaterialCommunityIcons name={item.icon as any} size={22} color={accent.icon} />
                  <Text variant="headlineSmall" style={{ color: accent.fg, fontWeight: '800' }}>
                    {item.value}
                  </Text>
                </View>
                <Text style={{ color: colors.muted }}>{item.label}</Text>
              </Card.Content>
            </Card>
          );
        })}
      </View>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>This week at a glance</Text>
          {loading ? (
            <Skeleton height={64} />
          ) : weeklyHighlights.length === 0 ? (
            <Text style={{ color: colors.muted, paddingVertical: spacing.sm }}>
              No shifts scheduled yet. Add shifts from the Schedule tab.
            </Text>
          ) : (
            weeklyHighlights.map((item: any) => (
              <View
                key={item.key}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingVertical: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                  gap: 12,
                }}
              >
                <Text style={{ color: colors.charcoal, fontWeight: '600', width: 42 }}>{item.day}</Text>
                <Text style={{ color: colors.muted, flex: 1 }}>{item.jobs}</Text>
                <Chip compact style={{ backgroundColor: item.isOpen ? accents[1].bg : accents[2].bg }} textStyle={{ color: item.isOpen ? accents[1].fg : accents[2].fg }}>
                  {item.isOpen ? 'Needs coverage' : 'Scheduled'}
                </Chip>
              </View>
            ))
          )}
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Who's clocked in right now</Text>
          {loading ? (
            <Skeleton height={64} />
          ) : liveStaff.length === 0 ? (
            <Text style={{ color: colors.muted, paddingVertical: spacing.sm }}>No one is clocked in right now.</Text>
          ) : (
            liveStaff.map((person: any) => (
              <View
                key={person.key}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingVertical: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                  gap: 10,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '600' }}>{person.name}</Text>
                  <Text style={{ color: colors.muted }}>{person.job}</Text>
                </View>
                <Chip compact style={{ backgroundColor: accents[3].bg }} textStyle={{ color: accents[3].fg }}>
                  {person.role}
                </Chip>
              </View>
            ))
          )}
        </Card.Content>
      </Card>
    </ScrollView>
  );
}
