import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Button, Card, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import { useAuthActions } from '@convex-dev/auth/react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';

type Mode = 'admin' | 'staff';

export default function SignInScreen() {
  const { signIn } = useAuthActions();
  const bootstrapProfile = useMutation(api.app.bootstrapProfile);
  const exchangePinForLogin = useMutation(api.staffAuth.exchangePinForLogin);
  const setSession = useAuthStore((state: AuthState) => state.setSession);

  const [mode, setMode] = useState<Mode>('staff');

  // Admin (email)
  const [flow, setFlow] = useState<'signIn' | 'signUp'>('signIn');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Staff (PIN)
  const [code, setCode] = useState('');
  const [pickedProfileId, setPickedProfileId] = useState<string | null>(null);
  const [pin, setPin] = useState('');

  const [submitting, setSubmitting] = useState(false);

  const roster = useQuery(api.staffAuth.getVenueRoster, code.trim().length >= 4 ? { code: code.trim().toUpperCase() } : 'skip');

  const finishSession = async () => {
    const { profile, venue } = await bootstrapProfile({});
    setSession({
      user: { id: profile._id, email: profile.email, full_name: profile.fullName, role: profile.role, job_title: profile.jobTitle, venue_id: profile.venueId ?? null },
      venue: venue ? { id: venue._id, name: venue.name, latitude: venue.latitude, longitude: venue.longitude, geofence_radius_m: venue.geofenceRadiusM } : null,
    });
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace('/(tabs)/home');
  };

  const onAdminSubmit = async () => {
    const trimmed = email.trim();
    if (!trimmed.includes('@') || password.trim().length < 6) {
      Alert.alert('Sign in failed', 'Enter a valid email and a password with at least 6 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await signIn('password', { email: trimmed, password, flow });
      await finishSession();
    } catch (e) {
      Alert.alert('Sign in failed', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const onPinSubmit = async () => {
    if (!pickedProfileId || !/^\d{4}$/.test(pin)) {
      Alert.alert('Enter your PIN', 'Pick your name and enter your 4-digit PIN.');
      return;
    }
    setSubmitting(true);
    try {
      const { loginHandle } = await exchangePinForLogin({
        code: code.trim().toUpperCase(),
        profileId: pickedProfileId as Id<'profiles'>,
        pin,
      });
      await signIn('password', { email: loginHandle, password: pin, flow: 'signIn' });
      await finishSession();
    } catch (e) {
      Alert.alert('Sign in failed', e instanceof Error ? e.message : 'Wrong PIN or code. Try again.');
      setPin('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: spacing.lg, justifyContent: 'center', gap: spacing.md }}>
        <View style={{ marginBottom: spacing.sm }}>
          <Text variant="headlineLarge" style={{ color: colors.primary, fontWeight: '800' }}>VenueFlow</Text>
          <Text variant="bodyMedium" style={{ color: colors.muted, marginTop: 6 }}>Premium venue ops for clock-in, shifts, and floor control.</Text>
        </View>

        <SegmentedButtons
          value={mode}
          onValueChange={(v) => setMode(v as Mode)}
          buttons={[
            { value: 'staff', label: 'Staff PIN' },
            { value: 'admin', label: 'Owner email' },
          ]}
        />

        {mode === 'admin' ? (
          <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
            <Card.Content style={{ gap: spacing.md }}>
              <SegmentedButtons
                value={flow}
                onValueChange={(v) => setFlow(v as 'signIn' | 'signUp')}
                buttons={[{ value: 'signIn', label: 'Sign in' }, { value: 'signUp', label: 'Create account' }]}
              />
              {flow === 'signUp' ? <TextInput label="Full name" value={fullName} onChangeText={setFullName} mode="outlined" /> : null}
              <TextInput label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" mode="outlined" />
              <TextInput label="Password" value={password} onChangeText={setPassword} secureTextEntry mode="outlined" />
              <Button mode="contained" buttonColor={colors.primary} loading={submitting} onPress={() => void onAdminSubmit()}>
                {flow === 'signUp' ? 'Create account' : 'Continue'}
              </Button>
            </Card.Content>
          </Card>
        ) : (
          <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
            <Card.Content style={{ gap: spacing.md }}>
              <TextInput
                label="Venue code"
                value={code}
                onChangeText={(t) => {
                  setCode(t.toUpperCase());
                  setPickedProfileId(null);
                }}
                autoCapitalize="characters"
                mode="outlined"
              />
              {code.trim().length >= 4 ? (
                roster === undefined ? (
                  <Text style={{ color: colors.muted }}>Looking up venue…</Text>
                ) : roster === null ? (
                  <Text style={{ color: colors.danger }}>No venue found for that code.</Text>
                ) : (
                  <View style={{ gap: spacing.sm }}>
                    <Text style={{ color: colors.muted }}>{roster.venueName} · pick your name</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {roster.staff.length === 0 ? (
                        <Text style={{ color: colors.muted }}>No staff invited yet. Ask your manager to invite you.</Text>
                      ) : (
                        roster.staff.map((s) => (
                          <Pressable
                            key={s.profileId}
                            onPress={() => {
                              setPickedProfileId(s.profileId);
                              setPin('');
                            }}
                            style={{
                              paddingVertical: 8,
                              paddingHorizontal: 14,
                              borderRadius: 999,
                              backgroundColor: pickedProfileId === s.profileId ? colors.primary : colors.cream,
                            }}
                          >
                            <Text style={{ color: pickedProfileId === s.profileId ? '#fff' : colors.charcoal, fontWeight: '600' }}>{s.fullName}</Text>
                          </Pressable>
                        ))
                      )}
                    </View>
                  </View>
                )
              ) : (
                <Text style={{ color: colors.muted }}>Ask your manager for the venue code.</Text>
              )}

              {pickedProfileId ? (
                <>
                  <TextInput
                    label="4-digit PIN"
                    value={pin}
                    onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, 4))}
                    keyboardType="number-pad"
                    secureTextEntry
                    maxLength={4}
                    mode="outlined"
                  />
                  <Button mode="contained" buttonColor={colors.primary} loading={submitting} onPress={() => void onPinSubmit()}>
                    Sign in
                  </Button>
                </>
              ) : null}
            </Card.Content>
          </Card>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
