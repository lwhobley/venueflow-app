import { View } from 'react-native';
import { Card, Chip, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { colors, spacing } from '../../lib/theme';
import { Skeleton } from '../../components/Skeleton';
import { useAuthStore, type AuthState } from '../../lib/auth-store';

export default function HomeScreen() {
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const dashboard = useQuery(api.app.getDashboard);

  const firstName = dashboard?.profile.fullName?.split(' ')[0] ?? user?.full_name?.split(' ')[0] ?? 'team';
  const role = dashboard?.profile.role ?? user?.role ?? 'staff';
  const venueName = dashboard?.venue.name ?? venue?.name ?? 'Main Venue';
  const openShifts = dashboard?.analytics.openShiftCount ?? 3;

  const analytics = dashboard
    ? [
        { label: 'Team members', value: String(dashboard.analytics.teamCount), icon: 'account-group' },
        { label: 'Scheduled shifts', value: String(dashboard.analytics.scheduledCount), icon: 'calendar-week' },
        { label: 'Open shifts', value: String(dashboard.analytics.openShiftCount), icon: 'calendar-remove' },
        { label: 'Clocked in now', value: String(dashboard.analytics.clockedInCount), icon: 'clock-check' },
      ]
    : [
        { label: 'Team members', value: '14', icon: 'account-group' },
        { label: 'Scheduled shifts', value: '26', icon: 'calendar-week' },
        { label: 'Open shifts', value: '3', icon: 'calendar-remove' },
        { label: 'Clocked in now', value: '5', icon: 'clock-check' },
      ];

  const weeklyHighlights = dashboard
    ? dashboard.schedule.slice(0, 5).map((shift: any) => ({
        day: shift.dayLabel,
        jobs: `${shift.memberName} · ${shift.jobTitle} · ${shift.startTime}–${shift.endTime}`,
        isOpen: shift.status === 'open',
      }))
    : [
        { day: 'Mon', jobs: 'Manager, Server, Host', isOpen: false },
        { day: 'Tue', jobs: 'Server, Bar, Support', isOpen: false },
        { day: 'Wed', jobs: 'Manager, Bar, Server', isOpen: false },
        { day: 'Thu', jobs: 'Host, Server, Kitchen', isOpen: false },
        { day: 'Fri', jobs: 'All hands dinner service', isOpen: true },
      ];

  const liveStaff = dashboard
    ? dashboard.activeClockEntries.map((person: any) => ({
        name: person.memberName,
        role: person.role,
        job: person.jobTitle,
        clockedIn: person.isOpen,
      }))
    : [
        { name: 'Mia Manager', role: 'manager', job: 'Shift Manager', clockedIn: true },
        { name: 'Sam Server', role: 'server', job: 'Dining Room', clockedIn: true },
        { name: 'Taylor Team', role: 'staff', job: 'Support', clockedIn: true },
        { name: 'Alex Admin', role: 'admin', job: 'Operations', clockedIn: true },
      ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md }}>
      <View style={{ gap: 4 }}>
        <Text variant="headlineMedium" style={{ color: colors.primary, fontFamily: 'serif' }}>
          Dashboard
        </Text>
        <Text style={{ color: colors.muted }}>
          Good to see you, {firstName}. {role.toUpperCase()} · {venueName}
        </Text>
      </View>

      {openShifts > 0 ? (
        <Card style={{ backgroundColor: '#F6E8E4' }}>
          <Card.Content style={{ gap: spacing.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <MaterialCommunityIcons name="alert-circle-outline" size={22} color={colors.danger} />
              <Text variant="titleMedium" style={{ color: colors.danger }}>
                Coverage alert
              </Text>
            </View>
            <Text style={{ color: colors.charcoal }}>
              {openShifts} open shift{openShifts === 1 ? '' : 's'} need coverage this week.
            </Text>
          </Card.Content>
        </Card>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {analytics.map((item: any) => (
          <Card key={item.label} style={{ backgroundColor: colors.surface, width: '48%', flexGrow: 1 }}>
            <Card.Content style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <MaterialCommunityIcons name={item.icon as any} size={22} color={colors.primary} />
                <Text variant="headlineSmall">{item.value}</Text>
              </View>
              <Text style={{ color: colors.muted }}>{item.label}</Text>
            </Card.Content>
          </Card>
        ))}
      </View>

      <Card style={{ backgroundColor: colors.surface }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium">This week at a glance</Text>
          {weeklyHighlights.map((item: any) => (
            <View
              key={`${item.day}-${item.jobs}`}
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
              <Chip compact selected={item.isOpen} style={{ backgroundColor: item.isOpen ? '#F6E8E4' : colors.cream }}>
                {item.isOpen ? 'Needs coverage' : 'Scheduled'}
              </Chip>
            </View>
          ))}
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, flex: 1 }}>
        <Card.Content style={{ gap: spacing.sm, flex: 1 }}>
          <Text variant="titleMedium">Who's clocked in right now</Text>
          {liveStaff.map((person: any) => (
            <View
              key={person.name}
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
                <Text>{person.name}</Text>
                <Text style={{ color: colors.muted }}>{person.job}</Text>
              </View>
              <Chip compact selected={person.clockedIn} style={{ backgroundColor: person.clockedIn ? '#E6F4EA' : colors.cream }}>
                {person.role}
              </Chip>
            </View>
          ))}
          {!dashboard ? (
            <View style={{ marginTop: spacing.sm }}>
              <Skeleton height={72} />
            </View>
          ) : null}
        </Card.Content>
      </Card>
    </View>
  );
}