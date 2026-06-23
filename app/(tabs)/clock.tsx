import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View, Linking, TextInput } from 'react-native';
import { Card, Text } from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { accents, colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { useAuthenticatedSession } from '../../lib/auth-readiness';
import { canManageVenue } from '../../lib/permissions';
import { getPreciseLocation, isWithinGeofence, type CurrentLocation } from '../../lib/location';
import { appApi, useApiMutation, useApiQuery } from '../../lib/api-client';

type ActiveClockEntry = {
  _id: string;
  memberName: string;
  jobTitle: string;
  venueName: string;
  clockInAt: number;
  clockInLat?: number;
  clockInLng?: number;
  clockInAccuracyM?: number;
  breaks?: any[];
};

type ManagerAlert = {
  kind: 'late_clock_in' | 'missed_clock_out';
  severity: 'warning' | 'danger';
  profileId: string;
  memberName: string;
  detail: string;
};

type PunchRow = {
  type: 'in' | 'out';
  at: number;
};

function fmtClock(d: Date) {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 === 0 ? 12 : h % 12;
  return { time: `${h}:${m.toString().padStart(2, '0')}`, ampm };
}
function fmtDate(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}
function fmtTime(at: number) {
  return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function ClockScreen() {
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const { isReady } = useAuthenticatedSession();
  const [location, setLocation] = useState<CurrentLocation | null>(null);
  const [loadingLocation, setLoadingLocation] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);

  const { data: clockBoard } = useApiQuery<any | null>(['app', 'clock-board'], '/v1/app/clock-board', isReady);
  const { data: dashboard } = useApiQuery<any | null>(['app', 'dashboard'], '/v1/app/dashboard', isReady);
  const { data: timeClock } = useApiQuery<any | null>(['app', 'time-clock'], '/v1/app/time-clock', isReady);

  const clockIn = useApiMutation(appApi.clockIn, [['app', 'clock-board'], ['app', 'dashboard'], ['app', 'time-clock']]);
  const clockOut = useApiMutation(appApi.clockOut, [['app', 'clock-board'], ['app', 'dashboard'], ['app', 'time-clock']]);
  const breakStart = useApiMutation(appApi.breakStart, [['app', 'clock-board'], ['app', 'dashboard'], ['app', 'time-clock']]);
  const breakEnd = useApiMutation(appApi.breakEnd, [['app', 'clock-board'], ['app', 'dashboard'], ['app', 'time-clock']]);
  const createCorrectionRequest = useApiMutation(appApi.createStaffRequest, [['app', 'listStaffRequests']]);

  const [showCorrection, setShowCorrection] = useState(false);
  const [correctionDate, setCorrectionDate] = useState('');
  const [correctionInTime, setCorrectionInTime] = useState('');
  const [correctionOutTime, setCorrectionOutTime] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');

  // Admin/owner/manager are salaried: they don't punch a time clock.
  const salaried = Boolean(dashboard?.profile && canManageVenue(dashboard.profile.role, dashboard.profile.allAccess));
  const isAdmin = salaried;

  const rawVenue = venue ?? clockBoard?.venue ?? dashboard?.venue ?? null;
  const activeVenue = useMemo(() => {
    if (!rawVenue) return null;
    const geofenceRadiusM = 'geofenceRadiusM' in rawVenue ? rawVenue.geofenceRadiusM : rawVenue.geofence_radius_m;
    return { name: rawVenue.name, latitude: rawVenue.latitude, longitude: rawVenue.longitude, geofenceRadiusM };
  }, [rawVenue]);

  const activeClockEntries = (clockBoard?.activeClockEntries ?? []) as ActiveClockEntry[];
  const managerAlerts = (clockBoard?.managerAlerts ?? []) as ManagerAlert[];
  const isClockedIn = timeClock?.isClockedIn ?? Boolean(clockBoard?.employeeEntry);

  const employeeEntry = clockBoard?.employeeEntry;
  const breaks = (employeeEntry?.breaks || []) as any[];
  const activeBreak = breaks.find((b: any) => b.endAt === null);
  const isOnBreak = Boolean(activeBreak);
  const breakType = activeBreak?.type;

  // Live ticking clock.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingLocation(true);
    getPreciseLocation()
      .then((next) => !cancelled && setLocation(next))
      .catch((error) => {
        if (!cancelled) Alert.alert('Location needed', error instanceof Error ? error.message : 'Unable to get your location.');
      })
      .finally(() => !cancelled && setLoadingLocation(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const canClock = Boolean(activeVenue && location && isWithinGeofence(location, activeVenue));

  const onPunch = async () => {
    if (!location || !canClock || busy) return;
    setBusy(true);
    try {
      const args = { lat: location.latitude, lng: location.longitude, accuracy: location.accuracy, mocked: location.mocked };
      if (isClockedIn) await clockOut.mutateAsync(args);
      else await clockIn.mutateAsync(args);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert('Punch failed', error instanceof Error ? error.message : 'Unable to record punch.');
    } finally {
      setBusy(false);
    }
  };

  const onStartBreak = async (type: 'paid' | 'unpaid') => {
    if (busy) return;
    setBusy(true);
    try {
      await breakStart.mutateAsync({ type });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert('Break failed', error instanceof Error ? error.message : 'Unable to start break.');
    } finally {
      setBusy(false);
    }
  };

  const onEndBreak = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await breakEnd.mutateAsync({});
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert('End break failed', error instanceof Error ? error.message : 'Unable to end break.');
    } finally {
      setBusy(false);
    }
  };

  const onSubmitCorrection = async () => {
    if (!correctionDate || !correctionInTime || !correctionOutTime || !correctionReason) {
      Alert.alert('Error', 'Please fill in all fields.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(correctionDate)) {
      Alert.alert('Error', 'Date must be in YYYY-MM-DD format.');
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(correctionInTime) || !/^\d{2}:\d{2}$/.test(correctionOutTime)) {
      Alert.alert('Error', 'Times must be in 24-hour HH:MM format (e.g. 09:00, 17:30).');
      return;
    }
    setBusy(true);
    try {
      const clockInAt = new Date(`${correctionDate}T${correctionInTime}:00`).getTime();
      const clockOutAt = new Date(`${correctionDate}T${correctionOutTime}:00`).getTime();
      if (isNaN(clockInAt) || isNaN(clockOutAt)) {
        Alert.alert('Error', 'Invalid date or time values.');
        return;
      }
      if (clockOutAt <= clockInAt) {
        Alert.alert('Error', 'Clock-out time must be after clock-in time.');
        return;
      }
      await createCorrectionRequest.mutateAsync({
        kind: 'time_correction',
        title: `Timesheet correction request for ${correctionDate}`,
        details: `Correct shift on ${correctionDate}: clock-in at ${correctionInTime}, clock-out at ${correctionOutTime}. Reason: ${correctionReason}`,
        availability: {
          timeEntryId: null,
          clockInAt,
          clockOutAt,
          reason: correctionReason,
        },
      });
      Alert.alert('Success', 'Correction request submitted to managers.');
      setShowCorrection(false);
      setCorrectionDate('');
      setCorrectionInTime('');
      setCorrectionOutTime('');
      setCorrectionReason('');
    } catch (error) {
      Alert.alert('Submission failed', error instanceof Error ? error.message : 'Unable to submit request.');
    } finally {
      setBusy(false);
    }
  };

  const { time, ampm } = fmtClock(now);
  const punches = (timeClock?.punches ?? []) as PunchRow[];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header: live time + date + venue pill */}
      <View style={{ backgroundColor: colors.primary, borderRadius: 22, padding: spacing.xl, alignItems: 'center', gap: 6 }}>
        <Text style={{ color: 'rgba(255,255,255,0.85)', fontWeight: '700' }}>{user?.full_name ?? 'Time clock'}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          <Text style={{ color: '#fff', fontSize: 56, fontWeight: '800', lineHeight: 60 }}>{time}</Text>
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 8, marginLeft: 4 }}>{ampm}</Text>
        </View>
        <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 16, fontWeight: '600' }}>{fmtDate(now)}</Text>
        <View style={{ marginTop: 8, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 18 }}>
          <Text style={{ color: '#fff', fontWeight: '600' }}>{activeVenue?.name ?? 'No venue'}</Text>
        </View>
      </View>

      {salaried ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
          <Card.Content style={{ gap: 4 }}>
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>Salaried role</Text>
            <Text style={{ color: colors.muted }}>
              {((r) => r.charAt(0).toUpperCase() + r.slice(1))(user?.role ?? 'manager')} positions are salaried — no clock-in required. Use the board below to see who's on the clock.
            </Text>
          </Card.Content>
        </Card>
      ) : null}

      {!salaried ? (
        <>
          {/* Punch Now button */}
          {isClockedIn && isOnBreak ? (
            <Pressable
              onPress={() => void onEndBreak()}
              disabled={busy}
              style={{
                backgroundColor: accents[1].fg,
                borderRadius: 18,
                paddingVertical: 20,
                alignItems: 'center',
                opacity: busy ? 0.7 : 1,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>
                {busy ? 'Working…' : `End ${breakType === 'paid' ? 'Paid' : 'Unpaid'} Break`}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => void onPunch()}
              disabled={!canClock || busy}
              style={{
                backgroundColor: canClock ? (isClockedIn ? colors.danger : colors.secondary) : colors.border,
                borderRadius: 18,
                paddingVertical: 20,
                alignItems: 'center',
                opacity: busy ? 0.7 : 1,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>
                {busy ? 'Working…' : isClockedIn ? 'Punch Out' : 'Punch Now'}
              </Text>
            </Pressable>
          )}

          {isClockedIn && !isOnBreak && (
            <Pressable
              onPress={() => {
                Alert.alert(
                  'Take a Break',
                  'Select your break type:',
                  [
                    { text: 'Paid Rest Break (15m)', onPress: () => void onStartBreak('paid') },
                    { text: 'Unpaid Meal Break (30m)', onPress: () => void onStartBreak('unpaid') },
                    { text: 'Cancel', style: 'cancel' }
                  ]
                );
              }}
              disabled={busy}
              style={{
                backgroundColor: colors.primary,
                borderRadius: 18,
                paddingVertical: 12,
                alignItems: 'center',
                marginTop: 4,
                opacity: busy ? 0.7 : 1,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Take Break</Text>
            </Pressable>
          )}

          {!canClock ? (
            <Text style={{ color: colors.muted, textAlign: 'center', marginTop: -4 }}>
              {loadingLocation
                ? 'Checking your location…'
                : !location
                  ? 'Location unavailable — enable GPS to punch.'
                  : location.mocked
                    ? 'Mocked location detected — punching is disabled.'
                    : `You must be within ${activeVenue?.geofenceRadiusM ?? 120}m of ${activeVenue?.name ?? 'your venue'} to punch.`}
            </Text>
          ) : (
            <Text style={{ color: accents[2].fg, textAlign: 'center', marginTop: -4 }}>
              ✓ You're inside the geofence{timeClock?.openSince ? ` · in since ${fmtTime(timeClock.openSince)}` : ''}{isOnBreak ? ` · (On ${breakType === 'paid' ? 'Paid' : 'Unpaid'} Break)` : ''}
            </Text>
          )}

          {/* Period totals */}
          <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
            <Card.Content style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="titleMedium" style={{ fontWeight: '700' }}>Period totals</Text>
                <Text style={{ color: colors.primary, fontWeight: '800' }}>Total Worked: {timeClock?.totalHours ?? 0}h</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 8 }}>
                <View>
                  <Text style={{ color: colors.muted }}>Regular Hours</Text>
                  <Text style={{ fontWeight: '700' }}>{timeClock?.regularHours ?? 0}h</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.lg, paddingTop: 4 }}>
                <View>
                  <Text style={{ color: colors.muted }}>Sick Balance</Text>
                  <Text style={{ fontWeight: '700', color: accents[1].fg }}>{timeClock?.sickHours ?? 0}h</Text>
                </View>
                <View>
                  <Text style={{ color: colors.muted }}>PTO Accrued</Text>
                  <Text style={{ fontWeight: '700', color: accents[2].fg }}>{timeClock?.ptoHours ?? 0}h</Text>
                </View>
              </View>
            </Card.Content>
          </Card>

          {/* Daily punches */}
          <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
            <Card.Content style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="titleMedium" style={{ fontWeight: '700' }}>Daily punches</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{fmtDate(now)}</Text>
              </View>
              {punches.length === 0 ? (
                <Text style={{ color: colors.muted }}>No punches yet today.</Text>
              ) : (
                punches.map((p, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: i < punches.length - 1 ? 1 : 0, borderBottomColor: colors.border }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <MaterialCommunityIcons name={p.type === 'in' ? 'login' : 'logout'} size={18} color={p.type === 'in' ? accents[2].fg : colors.danger} />
                      <Text>{p.type === 'in' ? 'Clock In' : 'Clock Out'}</Text>
                    </View>
                    <Text style={{ color: colors.primary, fontWeight: '700' }}>{fmtTime(p.at)}</Text>
                  </View>
                ))
              )}
            </Card.Content>
          </Card>

          {/* Time Correction Form */}
          <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
            <Card.Content style={{ gap: spacing.sm }}>
              <Pressable
                onPress={() => setShowCorrection(!showCorrection)}
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <Text variant="titleMedium" style={{ fontWeight: '700' }}>Request Time Correction</Text>
                <MaterialCommunityIcons
                  name={showCorrection ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={colors.muted}
                />
              </Pressable>

              {showCorrection && (
                <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    Forgot to clock in or need to adjust clock times? Request a manual timesheet adjustment below.
                  </Text>
                  <View style={{ gap: spacing.xs }}>
                    <Text style={{ fontWeight: '600', fontSize: 12, color: colors.charcoal }}>Date (YYYY-MM-DD)</Text>
                    <TextInput
                      placeholder="e.g. 2026-06-22"
                      value={correctionDate}
                      onChangeText={setCorrectionDate}
                      placeholderTextColor={colors.muted}
                      style={{
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: 8,
                        padding: 10,
                        backgroundColor: '#fff',
                        color: '#000',
                      }}
                    />
                  </View>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <View style={{ flex: 1, gap: spacing.xs }}>
                      <Text style={{ fontWeight: '600', fontSize: 12, color: colors.charcoal }}>In Time (24h HH:MM)</Text>
                      <TextInput
                        placeholder="e.g. 09:00"
                        value={correctionInTime}
                        onChangeText={setCorrectionInTime}
                        placeholderTextColor={colors.muted}
                        style={{
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: 8,
                          padding: 10,
                          backgroundColor: '#fff',
                          color: '#000',
                        }}
                      />
                    </View>
                    <View style={{ flex: 1, gap: spacing.xs }}>
                      <Text style={{ fontWeight: '600', fontSize: 12, color: colors.charcoal }}>Out Time (24h HH:MM)</Text>
                      <TextInput
                        placeholder="e.g. 17:00"
                        value={correctionOutTime}
                        onChangeText={setCorrectionOutTime}
                        placeholderTextColor={colors.muted}
                        style={{
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: 8,
                          padding: 10,
                          backgroundColor: '#fff',
                          color: '#000',
                        }}
                      />
                    </View>
                  </View>
                  <View style={{ gap: spacing.xs }}>
                    <Text style={{ fontWeight: '600', fontSize: 12, color: colors.charcoal }}>Reason</Text>
                    <TextInput
                      placeholder="e.g. Forgot to clock in"
                      value={correctionReason}
                      onChangeText={setCorrectionReason}
                      placeholderTextColor={colors.muted}
                      style={{
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: 8,
                        padding: 10,
                        backgroundColor: '#fff',
                        color: '#000',
                      }}
                    />
                  </View>
                  <Pressable
                    onPress={() => void onSubmitCorrection()}
                    disabled={busy}
                    style={{
                      backgroundColor: colors.primary,
                      borderRadius: 12,
                      paddingVertical: 12,
                      alignItems: 'center',
                      marginTop: 4,
                      opacity: busy ? 0.7 : 1,
                    }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '800' }}>Submit Correction Request</Text>
                  </Pressable>
                </View>
              )}
            </Card.Content>
          </Card>
        </>
      ) : null}

      {/* Manager board */}
      {isAdmin ? (
        <>
          <Card style={{ backgroundColor: managerAlerts.length > 0 ? '#FDE7E9' : colors.surface, borderRadius: 16 }}>
            <Card.Content style={{ gap: spacing.sm }}>
              <Text variant="titleMedium" style={{ fontWeight: '700' }}>Manager alerts</Text>
              {managerAlerts.length === 0 ? (
                <Text style={{ color: colors.muted }}>No late clock-ins or missed clock-outs right now.</Text>
              ) : (
                managerAlerts.map((alert) => (
                  <View key={`${alert.kind}-${alert.profileId}`} style={{ gap: 2, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <Text style={{ color: alert.severity === 'danger' ? colors.danger : accents[1].fg, fontWeight: '800' }}>{alert.memberName}</Text>
                    <Text style={{ color: colors.charcoal }}>{alert.detail}</Text>
                  </View>
                ))
              )}
            </Card.Content>
          </Card>
          <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
            <Card.Content style={{ gap: spacing.sm }}>
              <Text variant="titleMedium" style={{ fontWeight: '700' }}>Who's clocked in</Text>
              {activeClockEntries.length === 0 ? (
                <Text style={{ color: colors.muted }}>No one is clocked in right now.</Text>
              ) : (
                activeClockEntries.map((e) => (
                  <View key={e._id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View>
                        <Text style={{ fontWeight: '600' }}>{e.memberName}</Text>
                        <Text style={{ color: colors.muted }}>{e.jobTitle}</Text>
                      </View>
                      <Text style={{ color: colors.muted }}>in {fmtTime(e.clockInAt)}</Text>
                    </View>
                    {e.clockInLat !== undefined && e.clockInLat !== 0 && (
                      <Pressable
                        onPress={() => {
                          const url = `https://www.google.com/maps/search/?api=1&query=${e.clockInLat},${e.clockInLng}`;
                          Linking.openURL(url).catch(() => Alert.alert('Error', 'Unable to open maps.'));
                        }}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}
                      >
                        <MaterialCommunityIcons name="map-marker" size={14} color={colors.primary} />
                        <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '600' }}>
                          Punch Location (Accuracy: ±{Math.round(e.clockInAccuracyM ?? 0)}m) · View Map
                        </Text>
                      </Pressable>
                    )}
                  </View>
                ))
              )}
            </Card.Content>
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}
