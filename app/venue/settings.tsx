import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, IconButton, Text, TextInput } from 'react-native-paper';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { accents, colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { useAuthenticatedSession } from '../../lib/auth-readiness';
import { getPreciseLocation } from '../../lib/location';

export default function VenueSettingsScreen() {
  const venue = useAuthStore((state: AuthState) => state.venue);
  const setVenue = useAuthStore((state: AuthState) => state.setVenue);
  const updateVenue = useMutation(api.app.updateVenue);

  const { isReady, canManage } = useAuthenticatedSession();

  const [name, setName] = useState(venue?.name ?? '');
  const [lat, setLat] = useState(venue ? String(venue.latitude) : '');
  const [lng, setLng] = useState(venue ? String(venue.longitude) : '');
  const [radius, setRadius] = useState(venue?.geofence_radius_m ?? 120);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!venue) return;
    setName(venue.name);
    setLat(String(venue.latitude));
    setLng(String(venue.longitude));
    setRadius(venue.geofence_radius_m);
  }, [venue]);

  const useMyLocation = async () => {
    setError(null);
    setLocating(true);
    try {
      const loc = await getPreciseLocation();
      setLat(loc.latitude.toFixed(6));
      setLng(loc.longitude.toFixed(6));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read your location.');
    } finally {
      setLocating(false);
    }
  };

  const onSave = async () => {
    setError(null);
    setSaved(false);
    if (!venue?.id) {
      setError('No venue assigned to your account.');
      return;
    }
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
      setError('Enter valid latitude and longitude (decimal degrees).');
      return;
    }
    setSaving(true);
    try {
      const updated = await updateVenue({ venueId: venue.id, name: name.trim() || undefined, latitude, longitude, geofenceRadiusM: radius });
      setVenue({
        id: updated._id,
        name: updated.name,
        latitude: updated.latitude,
        longitude: updated.longitude,
        geofence_radius_m: updated.geofenceRadiusM,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save venue.');
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
        <Text style={{ color: colors.muted }}>Only managers and admins can edit venue settings.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <IconButton icon="arrow-left" onPress={() => router.back()} />
        <View>
          <Text variant="headlineMedium" style={{ color: colors.primary, fontWeight: '800' }}>Venue settings</Text>
          <Text style={{ color: colors.muted }}>Set your location so geofenced clock-in works.</Text>
        </View>
      </View>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Details</Text>
          <TextInput label="Venue name" value={name} onChangeText={setName} mode="outlined" style={{ backgroundColor: colors.surface }} />
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Location</Text>
          <Text style={{ color: colors.muted }}>
            Staff can only clock in within the geofence radius of this point. Stand at your venue and tap below.
          </Text>
          <Button mode="contained" buttonColor={colors.primary} icon="crosshairs-gps" loading={locating} onPress={() => void useMyLocation()}>
            Use my current location
          </Button>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TextInput label="Latitude" value={lat} onChangeText={setLat} mode="outlined" keyboardType="numbers-and-punctuation" autoCapitalize="none" style={{ flex: 1, backgroundColor: colors.surface }} />
            <TextInput label="Longitude" value={lng} onChangeText={setLng} mode="outlined" keyboardType="numbers-and-punctuation" autoCapitalize="none" style={{ flex: 1, backgroundColor: colors.surface }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ width: 110 }}>Geofence radius</Text>
            <IconButton icon="minus" mode="outlined" size={16} onPress={() => setRadius((r) => Math.max(20, r - 20))} />
            <Text style={{ minWidth: 56, textAlign: 'center' }}>{radius} m</Text>
            <IconButton icon="plus" mode="outlined" size={16} onPress={() => setRadius((r) => Math.min(2000, r + 20))} />
          </View>
        </Card.Content>
      </Card>

      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      {saved ? <Text style={{ color: accents[2].fg, textAlign: 'center' }}>Saved ✓</Text> : null}
      <Button mode="contained" buttonColor={colors.primary} icon="content-save" loading={saving} onPress={() => void onSave()}>
        Save venue location
      </Button>
    </ScrollView>
  );
}
