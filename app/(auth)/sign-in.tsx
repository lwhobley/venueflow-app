import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Button, Card, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import { useAuthActions } from '@convex-dev/auth/react';
import { useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';

type Flow = 'signIn' | 'signUp';

export default function SignInScreen() {
  const { signIn } = useAuthActions();
  const bootstrapProfile = useMutation(api.app.bootstrapProfile);
  const setSession = useAuthStore((state: AuthState) => state.setSession);

  const [flow, setFlow] = useState<Flow>('signIn');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail.includes('@') || password.trim().length < 6) {
      Alert.alert('Sign in failed', 'Enter a valid email and a password with at least 6 characters.');
      return;
    }

    setSubmitting(true);
    try {
      await signIn('password', { email: trimmedEmail, password, flow });
      const { profile, venue } = await bootstrapProfile({
        fullName: fullName.trim() || undefined,
      });
      setSession({
        user: {
          id: profile._id,
          email: profile.email,
          full_name: profile.fullName,
          role: profile.role,
          job_title: profile.jobTitle,
          venue_id: profile.venueId ?? null,
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
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)/home');
    } catch (error) {
      Alert.alert('Sign in failed', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: spacing.lg, justifyContent: 'center' }}>
        <View style={{ marginBottom: spacing.lg }}>
          <Text variant="headlineLarge" style={{ color: colors.primary, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' }}>
            VenueFlow
          </Text>
          <Text variant="bodyMedium" style={{ color: colors.muted, marginTop: 8 }}>
            Premium venue ops for clock-in, shifts, and floor control.
          </Text>
        </View>

        <Card style={{ backgroundColor: colors.surface }}>
          <Card.Content style={{ gap: spacing.md }}>
            <SegmentedButtons
              value={flow}
              onValueChange={(value) => setFlow(value as Flow)}
              buttons={[
                { value: 'signIn', label: 'Sign in' },
                { value: 'signUp', label: 'Create account' },
              ]}
            />
            {flow === 'signUp' ? (
              <TextInput label="Full name" value={fullName} onChangeText={setFullName} mode="outlined" />
            ) : null}
            <TextInput label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" mode="outlined" />
            <TextInput label="Password" value={password} onChangeText={setPassword} secureTextEntry mode="outlined" />

            <Button mode="contained" buttonColor={colors.primary} loading={submitting} onPress={onSubmit}>
              {flow === 'signUp' ? 'Create account' : 'Continue'}
            </Button>
          </Card.Content>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
