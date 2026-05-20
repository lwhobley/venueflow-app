import { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { Button, Card, Chip, Text } from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { getPreciseLocation, haversineMeters, type CurrentLocation } from '../../lib/location';

type ActiveClockEntry = {
  _id: string;
  memberName: string;
  jobTitle: string;
  venueName: string;
  clockInAt: number;
};

export default function ClockScreen() {
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const isAdmin = user?.role === 'admin' || user?.role === 'owner' || user?.role === 'manager';
  const [location, setLocation] = useState<CurrentLocation | null>(null);
  const [loadingLocation, setLoadingLocation] = useState(true);
  const clockBoard = useQuery(api.app.getClockBoard);
  const dashboard = useQuery(api.app.getDashboard);
  const clockIn = useMutation(api.app.clockIn);
  const clockOut = useMutation(api.app.clockOut);

  const activeVenue = venue ?? clockBoard?.venue ?? dashboard?.venue ?? null;
  const employeeEntry = clockBoard?.employeeEntry ?? null;
  const activeClockEntries = (clockBoard?.activeClockEntries ?? []) as ActiveClockEntry[];
  const isClockedIn = Boolean(employeeEntry);
  const openShiftCount = dashboard?.analytics.openShiftCount ?? 0;

  useEffect(() => {
    let cancelled = false;
    setLoadingLocation(true);
    getPreciseLocation()
      .then((nextLocation) => {
        if (!cancelled) setLocation(nextLocation);
      })
      .catch((error) => {
        if (!cancelled) {
          Alert.alert('Location needed', error instanceof Error ? error.message : 'Unable to get your location.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingLocation(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const distance = useMemo(() => {
    if (!location || !activeVenue) return null;
    return haversineMeters(location.latitude, location.longitude, activeVenue.latitude, activeVenue.longitude);
  }, [location, activeVenue]);

  const canClock = Boolean(
    activeVenue &&
      location &&
      location.accuracy <= 50 &&
      !location.mocked &&
      distance !== null &&
      distance <= activeVenue.geofenceRadiusM,
  );

  async function refreshLocation() {
    setLoadingLocation(true);
    try {
      const nextLocation = await getPreciseLocation();
      setLocation(nextLocation);
    } catch (error) {
      Alert.alert('Location needed', error instanceof Error ? error.message : 'Unable to get your location.');
    } finally {
      setLoadingLocation(false);
    }
  }

  const submitClockIn = async () => {
    if (!location || !canClock) return;
    try {
      await clockIn({
        lat: location.latitude,
        lng: location.longitude,
        accuracy: location.accuracy,
        mocked: location.mocked,
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert('Clock in failed', error instanceof Error ? error.message : 'Unable to clock in.');
    }
  };

  const submitClockOut = async () => {
    if (!location || !canClock) return;
    try {
      await clockOut({
        lat: location.latitude,
        lng: location.longitude,
        accuracy: location.accuracy,
        mocked: location.mocked,
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert('Clock out failed', error instanceof Error ? error.message : 'Unable to clock out.');
    }
  };

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md }}>
      <Card style={{ backgroundColor: colors.surface }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="headlineMedium" style={{ color: colors.primary, fontFamily: 'serif' }}>
            {isAdmin ? 'Admin Clock Board' : 'Employee Time Clock'}
          </Text>
          <Text style={{ color: colors.muted }}>
            {isAdmin
              ? 'See who is currently clocked in and whether they are inside the geofence.'
              : 'Clock in and out only when your live GPS position matches your assigned venue.'}
          </Text>
          {openShiftCount > 0 ? (
            <Chip compact style={{ alignSelf: 'flex-start', backgroundColor: '#F6E8E4' }} textStyle={{ color: colors.danger }}>
              {openShiftCount} open shift{openShiftCount === 1 ? '' : 's'} need coverage
            </Chip>
          ) : null}
        </Card.Content>
      </Card>

      {activeVenue ? (
        <Card style={{ backgroundColor: colors.surface }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <Text variant="titleMedium">Venue geofence preview</Text>
              <Chip compact>{activeVenue.geofenceRadiusM}m radius</Chip>
            </View>
            <View
              style={{
                height: 190,
                borderRadius: 20,
                backgroundColor: '#E9E1D4',
                borderWidth: 1,
                borderColor: colors.border,
                overflow: 'hidden',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <View
                style={{
                  width: 146,
                  height: 146,
                  borderRadius: 73,
                  borderWidth: 2,
                  borderColor: colors.success,
                  backgroundColor: 'rgba(46, 107, 74, 0.08)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: colors.primary }} />
              </View>
              <View style={{ position: 'absolute', bottom: 16, left: 16, right: 16, gap: 4 }}>
                <Text style={{ color: colors.charcoal, fontWeight: '600' }}>{activeVenue.name}</Text>
                <Text style={{ color: colors.muted }}>
                  {activeVenue.latitude.toFixed(4)}, {activeVenue.longitude.toFixed(4)}
                </Text>
              </View>
            </View>
          </Card.Content>
        </Card>
      ) : null}

      {!isAdmin ? (
        <>
          <Card style={{ backgroundColor: colors.surface }}>
            <Card.Content style={{ gap: spacing.sm }}>
              <Text variant="titleMedium">Current location</Text>
              {loadingLocation ? (
                <Text style={{ color: colors.muted }}>Checking GPS location…</Text>
              ) : location ? (
                <>
                  <Text>
                    You are {distance !== null ? `${Math.round(distance)}m` : '—'} from {activeVenue?.name ?? 'your venue'}
                  </Text>
                  <Text style={{ color: colors.muted }}>
                    Accuracy: {Math.round(location.accuracy)}m · Mocked: {location.mocked ? 'Yes' : 'No'}
                  </Text>
                </>
              ) : null}
              <Button mode="outlined" onPress={refreshLocation}>
                Refresh location
              </Button>
            </Card.Content>
          </Card>

          <Card style={{ backgroundColor: colors.surface }}>
            <Card.Content style={{ gap: spacing.sm }}>
              <Text variant="titleMedium">Your clock status</Text>
              <Text>{isClockedIn ? 'You are clocked in.' : 'You are not clocked in.'}</Text>

              {activeVenue ? (
                <View style={{ padding: 12, borderRadius: 14, backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.border, gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <MaterialCommunityIcons name="map-marker-radius" size={18} color={colors.primary} />
                    <Text>{activeVenue.name}</Text>
                  </View>
                  <Text style={{ color: colors.muted }}>{activeVenue.geofenceRadiusM}m geofence</Text>
                </View>
              ) : null}

              {isClockedIn ? (
                <Button mode="contained" buttonColor={colors.danger} disabled={!canClock} onPress={submitClockOut}>
                  Clock out
                </Button>
              ) : (
                <Button mode="contained" buttonColor={colors.primary} disabled={!canClock} onPress={submitClockIn}>
                  Clock in
                </Button>
              )}

              {!canClock && location && activeVenue ? (
                <Text style={{ color: colors.muted }}>
                  You're {distance !== null ? `${Math.round(distance)}m` : 'too far'} from {activeVenue.name}.
                  {location.mocked ? ' Mocked location detected.' : ''}
                </Text>
              ) : null}
            </Card.Content>
          </Card>
        </>
      ) : (
        <Card style={{ backgroundColor: colors.surface, flex: 1 }}>
          <Card.Content style={{ gap: spacing.sm, flex: 1 }}>
            <Text variant="titleMedium">Currently clocked in</Text>
            {activeClockEntries.length === 0 ? (
              <Text style={{ color: colors.muted }}>No employees are clocked in right now.</Text>
            ) : (
              activeClockEntries.map((person: ActiveClockEntry) => (
                <View
                  key={person._id}
                  style={{
                    paddingVertical: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                    gap: 6,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <Text style={{ fontWeight: '600' }}>{person.memberName}</Text>
                    <Chip compact selected>
                      {person.jobTitle}
                    </Chip>
                  </View>
                  <Text style={{ color: colors.muted }}>{person.venueName}</Text>
                  <Text style={{ color: colors.muted }}>
                    Clocked in at {new Date(person.clockInAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </Text>
                </View>
              ))
            )}
          </Card.Content>
        </Card>
      )}
    </ScrollView>
  );
}