import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Text, TextInput } from 'react-native-paper';
import { appApi, type VenueSearchResult } from '../../lib/api-client';
import { authCardStyle, authColors as colors, authInputProps as inputProps, spacing, type } from '../../lib/theme';
import { Kicker } from '../../components/AppCard';
import { useAuthStore, type AuthState } from '../../lib/auth-store';

export default function WorkplaceSearchScreen() {
  const token = useAuthStore((state: AuthState) => state.token);
  const [query, setQuery] = useState('');
  const [code, setCode] = useState('');
  const [venues, setVenues] = useState<VenueSearchResult[]>([]);
  const [selected, setSelected] = useState<VenueSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [joining, setJoining] = useState(false);

  const search = async () => {
    if (loading) return;
    const term = query.trim();
    if (!term) {
      Alert.alert('Search', 'Enter a venue name, address, or join code.');
      return;
    }
    if (!token) {
      router.replace('/(auth)/sign-in');
      return;
    }
    setLoading(true);
    try {
      const result = await appApi.searchVenues(term);
      setVenues(result.venues);
      setSelected(result.venues[0] ?? null);
    } catch (error) {
      Alert.alert('Search failed', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    if (joining) return;
    if (!selected) {
      Alert.alert('Choose a venue', 'Search and select the workplace you want to join.');
      return;
    }
    if (!code.trim()) {
      Alert.alert('Join code required', 'Ask your manager for the venue join code.');
      return;
    }
    setJoining(true);
    try {
      await appApi.submitJoinRequest({ venueId: selected.id, code: code.trim() });
      router.replace('/(auth)/join-pending');
    } catch (error) {
      Alert.alert('Could not send request', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setJoining(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: spacing.lg, justifyContent: 'center', gap: spacing.md }}>
        <View style={{ gap: 6 }}>
          <Kicker>Find your workplace</Kicker>
          <Text style={{ ...type.title, color: colors.text }}>Search for your venue</Text>
          <Text variant="bodyMedium" style={{ color: colors.muted }}>
            Search by name or address, then enter the join code your manager shared.
          </Text>
        </View>
        <Card style={authCardStyle}>
          <Card.Content style={{ gap: spacing.md }}>
            <TextInput {...inputProps} label="Venue name or address" value={query} onChangeText={setQuery} mode="outlined" />
            <Button mode="outlined" textColor={colors.primary} loading={loading} disabled={loading} onPress={() => void search()}>
              Search
            </Button>
            {venues.map((venue) => (
              <Button
                key={venue.id}
                mode={selected?.id === venue.id ? 'contained' : 'text'}
                buttonColor={selected?.id === venue.id ? colors.primary : undefined}
                textColor={selected?.id === venue.id ? colors.buttonText : colors.text}
                onPress={() => setSelected(venue)}
              >
                {venue.name}{venue.address ? ` · ${venue.address}` : ''}
              </Button>
            ))}
            <TextInput {...inputProps} label="Join code" value={code} onChangeText={setCode} autoCapitalize="characters" mode="outlined" />
            <Button mode="contained" buttonColor={colors.primary} textColor={colors.buttonText} loading={joining} disabled={joining} onPress={() => void submit()}>
              Request to join
            </Button>
            <Button mode="text" textColor={colors.primary} onPress={() => router.replace('/(auth)/invite-check')}>
              I have an email invite
            </Button>
          </Card.Content>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
