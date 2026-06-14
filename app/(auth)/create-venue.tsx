import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Button, Card, Chip, Text, TextInput } from 'react-native-paper';
import { appApi } from '../../lib/api-client';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { authCardStyle, authColors as colors, authInputProps as inputProps, spacing } from '../../lib/theme';

const STAFF_RANGES = ['1-15', '16-30', '31-50'] as const;
const VENUE_TYPES = ['restaurant', 'bar', 'hotel', 'cafe', 'nightclub', 'event_venue', 'other'] as const;

const venueTypeLabels: Record<string, string> = {
  restaurant: 'Restaurant',
  bar: 'Bar',
  hotel: 'Hotel',
  cafe: 'Cafe',
  nightclub: 'Nightclub',
  event_venue: 'Event venue',
  other: 'Other',
};

export default function CreateVenueScreen() {
  const venue = useAuthStore((s: AuthState) => s.venue);
  const setSession = useAuthStore((s: AuthState) => s.setSession);
  const token = useAuthStore((s: AuthState) => s.token);

  useEffect(() => {
    if (venue) {
      router.replace('/(tabs)/home');
    }
  }, [venue]);

  const [businessName, setBusinessName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [venueType, setVenueType] = useState<string>('restaurant');
  const [staffRange, setStaffRange] = useState<string>('1-15');
  const [submitting, setSubmitting] = useState(false);

  if (venue) return null;

  const submit = async () => {
    if (!businessName.trim()) {
      Alert.alert('Business name', 'Enter your business name to continue.');
      return;
    }
    setSubmitting(true);
    try {
      const { profile, venue } = await appApi.registerVenue({
        businessName: businessName.trim(),
        staffRange,
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
        venueType,
      });
      setSession({
        user: {
          id: profile._id,
          email: profile.email,
          full_name: profile.fullName,
          email_verified: profile.emailVerified === true,
          role: profile.role,
          job_title: profile.jobTitle,
          venue_id: profile.venueId ?? null,
          all_access: profile.allAccess === true,
        },
        venue: venue
          ? {
              id: venue._id,
              name: venue.name,
              latitude: venue.latitude,
              longitude: venue.longitude,
              geofence_radius_m: venue.geofenceRadiusM,
            }
          : null,
        token,
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)/home');
    } catch (e) {
      Alert.alert('Could not create venue', e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          padding: spacing.lg,
          gap: spacing.md,
          paddingTop: spacing.xl,
        }}
      >
        <View style={{ gap: 4 }}>
          <Text variant="headlineMedium" style={{ color: colors.text, fontWeight: '700' }}>
            Set up your venue
          </Text>
          <Text variant="bodyMedium" style={{ color: colors.muted }}>
            Tell us about your business. You can update these details later.
          </Text>
        </View>

        <Card style={styles.card}>
          <Card.Content style={{ gap: spacing.sm }}>
            <TextInput
              {...inputProps}
              label="Business name"
              value={businessName}
              onChangeText={setBusinessName}
              mode="outlined"
            />

            <TextInput
              {...inputProps}
              label="Address (optional)"
              value={address}
              onChangeText={setAddress}
              mode="outlined"
            />

            <TextInput
              {...inputProps}
              label="Phone (optional)"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              mode="outlined"
            />

            <View style={{ gap: 4 }}>
              <Text variant="labelLarge" style={{ color: colors.text }}>Venue type</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {VENUE_TYPES.map((t) => (
                  <Chip key={t} selected={venueType === t} onPress={() => setVenueType(t)}>
                    {venueTypeLabels[t]}
                  </Chip>
                ))}
              </View>
            </View>

            <View style={{ gap: 4 }}>
              <Text variant="labelLarge" style={{ color: colors.text }}>Team size</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {STAFF_RANGES.map((r) => (
                  <Chip key={r} selected={staffRange === r} onPress={() => setStaffRange(r)}>
                    {r} staff
                  </Chip>
                ))}
              </View>
            </View>

            <Button
              mode="contained"
              buttonColor={colors.primary}
              textColor={colors.buttonText}
              loading={submitting}
              onPress={() => void submit()}
              style={{ marginTop: spacing.sm }}
            >
              Create venue
            </Button>
          </Card.Content>
        </Card>

        <Button mode="text" textColor={colors.muted} onPress={() => router.back()}>
          Back
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  card: {
    ...authCardStyle,
  },
});
