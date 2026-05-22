import { ScrollView, View } from 'react-native';
import { Card, Chip, Text } from 'react-native-paper';
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
  const notifications = useQuery(api.app.getNotifications);
  const markNotificationRead = useMutation(api.app.markNotificationRead);
  const loading = dashboard === undefined;

  const firstName = dashboard?.profile.fullName?.split(' ')[0] ?? user?.full_name?.split(' ')[0] ?? 'there';
  const role = dashboard?.profile.role ?? user?.role ?? 'staff';
  const venueName = dashboard?.venue.name ?? venue?.name ?? 'your venue';
  const openShifts = dashboard?.analytics.openShiftCount ?? 0;

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
