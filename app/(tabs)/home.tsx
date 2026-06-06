import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { TextInput } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import type { Id } from '../../lib/ids';
import { CommandButton, CommandSurface, CommandText, MiniTrend, StatusPill } from '../../components/FutureUI';
import { AiCopilotPanel } from '../../components/AiCopilotPanel';
import { AlertsPanel } from '../../components/AlertsPanel';
import { CosmicInsights } from '../../components/CosmicInsights';
import { Skeleton } from '../../components/Skeleton';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { usePushNotifications } from '../../lib/usePushNotifications';
import { useAuthenticatedSession } from '../../lib/auth-readiness';
import { spacing, useAppearanceStore, useDesignTheme } from '../../lib/theme';
import { LocaleCode, useI18n, useLocaleStore } from '../../lib/i18n';
import { canManageVenue } from '../../lib/permissions';

type NotificationItem = {
  _id: Id<'notificationEvents'>;
  title: string;
  body: string;
  read: boolean;
};

const languageOptions: LocaleCode[] = ['en', 'es', 'fr', 'pseudo'];

export default function HomeScreen() {
  usePushNotifications();
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const { isReady } = useAuthenticatedSession();
  const dashboard = useQuery(api.app.getDashboard, isReady ? {} : 'skip');
  const notifications = useQuery(api.app.getNotifications, isReady ? {} : 'skip');
  const markNotificationRead = useMutation(api.app.markNotificationRead);
  const upsertManagerGoal = useMutation(api.operations.upsertManagerGoal);
  const palette = useDesignTheme();
  const themeMode = useAppearanceStore((state) => state.mode);
  const setThemeMode = useAppearanceStore((state) => state.setMode);
  const setLocale = useLocaleStore((state) => state.setLocale);
  const { locale, t, formatCurrency, formatDate, formatNumber } = useI18n();
  const loading = dashboard === undefined;

  const firstName = dashboard?.profile.fullName?.split(' ')[0] ?? user?.full_name?.split(' ')[0] ?? '';
  const role = dashboard?.profile.role ?? 'staff';
  const roleLabel = t(`roles.${role as 'owner' | 'admin' | 'manager' | 'staff'}`);
  const venueName = dashboard?.venue.name ?? venue?.name ?? '';
  const openShifts = dashboard?.analytics.openShiftCount ?? 0;
  const canManage = canManageVenue(role, dashboard?.profile.allAccess ?? user?.all_access);
  const managerDashboard = useQuery(api.operations.getManagerDashboard, isReady && canManage && venue?.id ? { venueId: venue.id } : 'skip') as any;
  const managerInsights = useQuery(api.app.getManagerInsights, isReady && canManage ? {} : 'skip');
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const [goalTitle, setGoalTitle] = useState('');
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);

  const reservations = managerDashboard?.vipOrLargeReservations ?? [];
  const reservationCount = managerDashboard?.totalReservations ?? 0;
  const todayReservations = managerDashboard?.todayReservations ?? 0;
  const vipCount = reservations.length ?? 0;
  const eventCount = managerDashboard?.events?.length ?? 0;
  const scheduledCount = dashboard?.analytics.scheduledCount ?? 0;
  const clockedInCount = dashboard?.analytics.clockedInCount ?? 0;
  const teamCount = dashboard?.analytics.teamCount ?? Math.max(clockedInCount, scheduledCount);
  const readiness = teamCount > 0 ? Math.round((clockedInCount / teamCount) * 100) : 0;

  const kpis = useMemo(
    () => [
      { label: t('dashboard.covers'), value: formatNumber(todayReservations), delta: t('common.today'), icon: 'silverware-fork-knife' as const, trend: [0] },
      { label: t('dashboard.revenue'), value: formatCurrency(0), delta: t('dashboard.pacingLabel'), icon: 'chart-line' as const, trend: [0] },
      { label: t('dashboard.occupancy'), value: '0%', delta: t('dashboard.fullFloor'), icon: 'seat' as const, trend: [0] },
      { label: t('dashboard.turns'), value: formatNumber(0, { maximumFractionDigits: 1 }), delta: t('dashboard.tableTurns'), icon: 'rotate-3d-variant' as const, trend: [0] },
      { label: t('dashboard.guestSpend'), value: formatCurrency(0), delta: t('dashboard.vipLabel'), icon: 'account-star-outline' as const, trend: [0] },
      { label: t('dashboard.staffReady'), value: `${readiness}%`, delta: openShifts ? t('dashboard.watch') : t('dashboard.clear'), icon: 'account-check-outline' as const, trend: [readiness] },
    ],
    [formatCurrency, formatNumber, openShifts, readiness, t, todayReservations],
  );

  const weeklyHighlights = dashboard
    ? dashboard.schedule.slice(0, 5).map((shift: any) => ({
        key: shift._id,
        day: shift.dayLabel,
        jobs: `${shift.memberName} · ${shift.jobTitle} · ${shift.startTime}-${shift.endTime}`,
        isOpen: shift.status === 'open',
      }))
    : [];

  const liveStaff = dashboard
    ? dashboard.activeClockEntries.map((person: any) => ({
        key: person._id,
        name: person.memberName,
        role: person.role,
        job: person.jobTitle,
      }))
    : [];

  const recentNotifications = (notifications ?? []) as NotificationItem[];
  const unreadNotifications = recentNotifications.filter((item) => !item.read);

  const addGoal = async () => {
    if (!venue?.id || !goalTitle.trim()) return;
    await upsertManagerGoal({ venueId: venue.id, title: goalTitle.trim(), period: 'day', targetDate: todayKey, status: 'open' });
    setGoalTitle('');
  };

  const markAllAlertsRead = async () => {
    await Promise.all(unreadNotifications.map((item) => markNotificationRead({ notificationId: item._id })));
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ gap: spacing.md, paddingTop: spacing.sm }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
          <View style={{ minWidth: 220, flex: 1 }}>
            <CommandText palette={palette} variant="label">{t('common.venueWrangler')}</CommandText>
            <CommandText palette={palette} variant="hero">{t('dashboard.title')}</CommandText>
            <CommandText palette={palette} variant="caption">
              {t('dashboard.greeting', { name: firstName })} {t('dashboard.roleVenue', { role: roleLabel, venue: venueName })}
            </CommandText>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.xs }}>
            <CommandButton palette={palette} icon="calendar-today">{formatDate(today, { month: '2-digit', day: '2-digit' })}</CommandButton>
            <CommandButton palette={palette} icon={unreadNotifications.length ? 'bell-ring-outline' : 'bell-outline'} selected={alertsOpen} onPress={() => setAlertsOpen((value) => !value)}>
              {unreadNotifications.length ? `${t('command.alerts')} ${unreadNotifications.length}` : t('command.alerts')}
            </CommandButton>
            <CommandButton palette={palette} icon="creation" selected={copilotOpen} onPress={() => setCopilotOpen((value) => !value)}>
              {copilotOpen ? 'Copilot Active' : t('command.ai')}
            </CommandButton>
          </View>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <TextInput
            accessibilityLabel={t('command.searchPlaceholder')}
            placeholder={t('command.searchPlaceholder')}
            mode="outlined"
            dense
            outlineColor={palette.border}
            activeOutlineColor={palette.primary}
            textColor={palette.charcoal}
            placeholderTextColor={palette.muted}
            style={{ flexGrow: 1, flexBasis: 220, backgroundColor: palette.surfaceSoft }}
          />
          <CommandButton palette={palette} icon="domain">{venueName || t('command.property')}</CommandButton>
          {(['dark', 'light'] as const).map((mode) => (
            <CommandButton
              key={mode}
              palette={palette}
              selected={themeMode === mode}
              onPress={() => setThemeMode(mode)}
              accessibilityLabel={mode === 'dark' ? t('command.themeDark') : t('command.themeLight')}
            >
              {mode === 'dark' ? t('command.themeDark') : t('command.themeLight')}
            </CommandButton>
          ))}
          {languageOptions.map((option) => (
            <CommandButton key={option} palette={palette} selected={locale === option} onPress={() => setLocale(option)}>
              {option.toUpperCase()}
            </CommandButton>
          ))}
        </View>
      </View>

      {alertsOpen ? (
        <AlertsPanel
          palette={palette}
          notifications={recentNotifications}
          onClose={() => setAlertsOpen(false)}
          onMarkRead={(notificationId) => void markNotificationRead({ notificationId })}
          onMarkAllRead={() => void markAllAlertsRead()}
        />
      ) : null}

      {copilotOpen ? (
        <AiCopilotPanel
          palette={palette}
          insights={managerInsights}
          dashboard={dashboard}
          onClose={() => setCopilotOpen(false)}
        />
      ) : null}

      {openShifts > 0 ? (
        <CommandSurface palette={palette} strong style={{ gap: spacing.sm, borderColor: palette.warning }}>
          <StatusPill palette={palette} tone="warn">{t('dashboard.coverageAlert')}</StatusPill>
          <CommandText palette={palette} variant="body">{t('dashboard.openShiftNotice', { count: openShifts })}</CommandText>
        </CommandSurface>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {kpis.map((item) => (
          <CommandSurface key={item.label} palette={palette} inset style={{ flexGrow: 1, flexBasis: 150, gap: spacing.sm, minHeight: 136 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
              <MaterialCommunityIcons name={item.icon} size={19} color={palette.primary} />
              <MiniTrend palette={palette} values={item.trend} />
            </View>
            <CommandText palette={palette} variant="metric">{item.value}</CommandText>
            <View style={{ gap: 2 }}>
              <CommandText palette={palette} variant="label">{item.label}</CommandText>
              <CommandText palette={palette} variant="caption">{item.delta}</CommandText>
            </View>
          </CommandSurface>
        ))}
      </View>

      {canManage ? (
        <CommandSurface palette={palette} style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm }}>
            <View style={{ flex: 1, minWidth: 210 }}>
              <CommandText palette={palette} variant="title">{t('dashboard.managerCenter')}</CommandText>
              <CommandText palette={palette} variant="caption">{t('dashboard.recentReservations', { count: reservationCount })}</CommandText>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              <StatusPill palette={palette}>{formatNumber(todayReservations)} {t('common.today')}</StatusPill>
              <StatusPill palette={palette} tone="warn">{formatNumber(vipCount)} {t('dashboard.vipLabel')} / {t('dashboard.largeLabel')}</StatusPill>
              <StatusPill palette={palette} tone="good">{formatNumber(eventCount)} {t('dashboard.eventsLabel')}</StatusPill>
            </View>
          </View>
          <TextInput
            label={t('dashboard.managerGoal')}
            value={goalTitle}
            onChangeText={setGoalTitle}
            mode="outlined"
            outlineColor={palette.border}
            activeOutlineColor={palette.primary}
            textColor={palette.charcoal}
            style={{ backgroundColor: palette.surfaceSoft }}
          />
          <CommandButton palette={palette} icon="target" onPress={() => void addGoal()} style={{ alignSelf: 'flex-start' }}>
            {t('dashboard.addGoal')}
          </CommandButton>
          {(managerDashboard?.goals ?? []).slice(0, 4).map((goal: any) => (
            <View key={goal._id} style={{ borderTopWidth: 1, borderTopColor: palette.divider, paddingTop: spacing.sm, gap: 2 }}>
              <CommandText palette={palette} variant="body">{goal.title}</CommandText>
              <CommandText palette={palette} variant="caption">{goal.period} · {goal.targetDate} · {goal.status}</CommandText>
            </View>
          ))}
        </CommandSurface>
      ) : null}

      {canManage ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <CommandSurface palette={palette} style={{ flexGrow: 2, flexBasis: 280, gap: spacing.md }}>
            <CommandText palette={palette} variant="title">{t('dashboard.reservationsTimeline')}</CommandText>
            {reservations.length === 0 ? (
              <CommandText palette={palette} variant="caption">{t('dashboard.noNotifications')}</CommandText>
            ) : (
              reservations.slice(0, 5).map((reservation: any, index: number) => (
                <View key={reservation._id} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                  <View style={{ width: 7, height: 42, borderRadius: 99, backgroundColor: index === 0 ? palette.primary : palette.border }} />
                  <View style={{ flex: 1 }}>
                    <CommandText palette={palette} variant="body">{reservation.guestName}</CommandText>
                    <CommandText palette={palette} variant="caption">
                      {formatDate(reservation.reservationTime, { hour: 'numeric', minute: '2-digit' })} · {formatNumber(reservation.partySize)} {t('dashboard.coversLabel')}
                    </CommandText>
                  </View>
                  <StatusPill palette={palette} tone={reservation.partySize >= 8 ? 'warn' : 'neutral'}>{reservation.partySize >= 8 ? t('dashboard.largeLabel') : t('dashboard.arrivals')}</StatusPill>
                </View>
              ))
            )}
          </CommandSurface>

          <CommandSurface palette={palette} style={{ flexGrow: 1, flexBasis: 240, gap: spacing.md }}>
            <CommandText palette={palette} variant="title">{t('dashboard.floorControl')}</CommandText>
            {[
              [t('dashboard.seatingFlow'), 0, palette.primary],
              [t('dashboard.kitchenFire'), 0, palette.warning],
              [t('dashboard.barQueue'), 0, openShifts ? palette.danger : palette.success],
            ].map(([label, value, color]) => (
              <View key={String(label)} style={{ gap: spacing.xs }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <CommandText palette={palette} variant="caption">{String(label)}</CommandText>
                  <CommandText palette={palette} variant="caption">{formatNumber(Number(value))}%</CommandText>
                </View>
                <View style={{ height: 8, borderRadius: 99, backgroundColor: palette.surfaceSoft, overflow: 'hidden' }}>
                  <View style={{ width: `${Math.min(100, Number(value))}%`, height: '100%', backgroundColor: String(color), borderRadius: 99 }} />
                </View>
              </View>
            ))}
          </CommandSurface>
        </View>
      ) : (
        <CosmicInsights />
      )}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <CommandSurface palette={palette} style={{ flexGrow: 1, flexBasis: 260, gap: spacing.sm }}>
          <CommandText palette={palette} variant="title">{t('dashboard.eventRun')}</CommandText>
          {(managerDashboard?.events ?? []).slice(0, 4).map((event: any) => (
            <View key={event._id} style={{ borderBottomWidth: 1, borderBottomColor: palette.divider, paddingBottom: spacing.sm, gap: 2 }}>
              <CommandText palette={palette} variant="body">{event.title}</CommandText>
              <CommandText palette={palette} variant="caption">{event.eventDate} · {event.status}</CommandText>
            </View>
          ))}
          {(managerDashboard?.events ?? []).length === 0 ? <CommandText palette={palette} variant="caption">{t('dashboard.clear')}</CommandText> : null}
        </CommandSurface>

        <CommandSurface palette={palette} style={{ flexGrow: 1, flexBasis: 260, gap: spacing.sm }}>
          <CommandText palette={palette} variant="title">{t('dashboard.staffing')}</CommandText>
          {loading ? (
            <Skeleton height={64} />
          ) : weeklyHighlights.length === 0 ? (
            <CommandText palette={palette} variant="caption">{t('dashboard.noShifts')}</CommandText>
          ) : (
            weeklyHighlights.map((item: any) => (
              <View key={item.key} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: palette.divider, paddingBottom: spacing.sm }}>
                <CommandText palette={palette} variant="label" style={{ width: 42 }}>{item.day}</CommandText>
                <CommandText palette={palette} variant="caption" style={{ flex: 1 }}>{item.jobs}</CommandText>
                <StatusPill palette={palette} tone={item.isOpen ? 'warn' : 'good'}>{item.isOpen ? t('common.needsCoverage') : t('common.scheduled')}</StatusPill>
              </View>
            ))
          )}
        </CommandSurface>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <CommandSurface palette={palette} style={{ flexGrow: 1, flexBasis: 260, gap: spacing.sm }}>
          <CommandText palette={palette} variant="title">{canManage ? t('dashboard.vipInsights') : t('dashboard.analytics')}</CommandText>
          {canManage && reservations.length > 0 ? (
            reservations.slice(0, 3).map((reservation: any) => (
              <View key={reservation._id} style={{ gap: 2, borderBottomWidth: 1, borderBottomColor: palette.divider, paddingBottom: spacing.sm }}>
                <CommandText palette={palette} variant="body">{reservation.guestName} · {formatNumber(reservation.partySize)}</CommandText>
                <CommandText palette={palette} variant="caption">{formatDate(reservation.reservationTime, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</CommandText>
                {reservation.notes ? <CommandText palette={palette} variant="caption">{reservation.notes}</CommandText> : null}
              </View>
            ))
          ) : (
            <CosmicInsights />
          )}
        </CommandSurface>

        <CommandSurface palette={palette} style={{ flexGrow: 1, flexBasis: 260, gap: spacing.sm }}>
          <CommandText palette={palette} variant="title">{t('dashboard.notifications')}</CommandText>
          {recentNotifications.length === 0 ? (
            <CommandText palette={palette} variant="caption">{t('dashboard.noNotifications')}</CommandText>
          ) : (
            recentNotifications.slice(0, 4).map((item) => (
              <View key={item._id} style={{ borderBottomWidth: 1, borderBottomColor: palette.divider, paddingBottom: spacing.sm, gap: 4 }}>
                <CommandText palette={palette} variant="body" style={{ fontWeight: item.read ? '600' : '900' }}>{item.title}</CommandText>
                <CommandText palette={palette} variant="caption">{item.body}</CommandText>
                {!item.read ? (
                  <CommandButton palette={palette} onPress={() => void markNotificationRead({ notificationId: item._id })} style={{ alignSelf: 'flex-start' }}>
                    {t('common.markRead')}
                  </CommandButton>
                ) : null}
              </View>
            ))
          )}
        </CommandSurface>
      </View>

      {canManage ? (
        <CommandSurface palette={palette} style={{ gap: spacing.sm }}>
          <CommandText palette={palette} variant="title">{t('dashboard.clockedIn')}</CommandText>
          {loading ? (
            <Skeleton height={64} />
          ) : liveStaff.length === 0 ? (
            <CommandText palette={palette} variant="caption">{t('dashboard.noClockedIn')}</CommandText>
          ) : (
            liveStaff.map((person: any) => (
              <View key={person.key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: palette.divider, paddingBottom: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <CommandText palette={palette} variant="body">{person.name}</CommandText>
                  <CommandText palette={palette} variant="caption">{person.job}</CommandText>
                </View>
                <StatusPill palette={palette}>{person.role}</StatusPill>
              </View>
            ))
          )}
        </CommandSurface>
      ) : null}

    </ScrollView>
  );
}
