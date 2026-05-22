import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { Card, Text } from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { accents, colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { getPreciseLocation, isWithinGeofence, type CurrentLocation } from '../../lib/location';

type ActiveClockEntry = {
  _id: string;
  memberName: string;
  jobTitle: string;
  venueName: string;
  clockInAt: number;
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
  // Admin/owner/manager are salaried: they don't punch a time clock.
  const salaried = user?.role === 'admin' || user?.role === 'owner' || user?.role === 'manager';
  const isAdmin = salaried;
  const [location, setLocation] = useState<CurrentLocation | null>(null);
  const [loadingLocation, setLoadingLocation] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);

  const clockBoard = useQuery(api.app.getClockBoard);
  const dashboard = useQuery(api.app.getDashboard);
  const timeClock = useQuery(api.app.getMyTimeClock);
  const clockIn = useMutation(api.app.clockIn);
  const clockOut = useMutation(api.app.clockOut);

  const rawVenue = venue ?? clockBoard?.venue ?? dashboard?.venue ?? null;
  const activeVenue = useMemo(() => {
    if (!rawVenue) return null;
    const geofenceRadiusM = 'geofenceRadiusM' in rawVenue ? rawVenue.geofenceRadiusM : rawVenue.geofence_radius_m;
    return { name: rawVenue.name, latitude: rawVenue.latitude, longitude: rawVenue.longitude, geofenceRadiusM };
  }, [rawVenue]);

  const activeClockEntries = (clockBoard?.activeClockEntries ?? []) as ActiveClockEntry[];
  const isClockedIn = timeClock?.isClockedIn ?? Boolean(clockBoard?.employeeEntry);

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
      if (isClockedIn) await clockOut(args);
      else await clockIn(args);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert('Punch failed', error instanceof Error ? error.message : 'Unable to record punch.');
    } finally {
      setBusy(false);
    }
  };

  const { time, ampm } = fmtClock(now);
  const punches = timeClock?.punches ?? [];

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
              {(user?.role ?? 'manager').toUpperCase()} positions are salaried — no clock-in required. Use the board below to see who's on the clock.
            </Text>
          </Card.Content>
        </Card>
      ) : null}

      {!salaried ? (
      <>
      {/* Punch Now button */}
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
          ✓ You're inside the geofence{timeClock?.openSince ? ` · in since ${fmtTime(timeClock.openSince)}` : ''}
        </Text>
      )}

      {/* Period totals */}
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>Period totals</Text>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>Total: {timeClock?.totalHours ?? 0}h</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.lg }}>
            <View>
              <Text style={{ color: colors.muted }}>Regular</Text>
              <Text style={{ fontWeight: '700' }}>{timeClock?.regularHours ?? 0}h</Text>
            </View>
            <View>
              <Text style={{ color: colors.muted }}>Sick</Text>
              <Text style={{ fontWeight: '700' }}>{timeClock?.sickHours ?? 0}h</Text>
            </View>
          </View>
        </Card.Content>
      </Card>

      {/* Daily punches */}
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Daily punches</Text>
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
      </>
      ) : null}

      {/* Manager board */}
      {isAdmin ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>Who's clocked in</Text>
            {activeClockEntries.length === 0 ? (
              <Text style={{ color: colors.muted }}>No one is clocked in right now.</Text>
            ) : (
              activeClockEntries.map((e) => (
                <View key={e._id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <View>
                    <Text style={{ fontWeight: '600' }}>{e.memberName}</Text>
                    <Text style={{ color: colors.muted }}>{e.jobTitle}</Text>
                  </View>
                  <Text style={{ color: colors.muted }}>in {fmtTime(e.clockInAt)}</Text>
                </View>
              ))
            )}
          </Card.Content>
        </Card>
      ) : null}
    </ScrollView>
  );
}
