import { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Button, Card, Divider, Text, TextInput } from 'react-native-paper';
import { appApi, type VenueSearchResult } from '../../lib/api-client';
import { spacing } from '../../lib/theme';

const colors = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  primary: '#2F7D46',
  text: '#1F241E',
  muted: '#6F766B',
  border: '#E8E2D8',
  danger: '#B85047',
  buttonText: '#FFFFFF',
  highlight: '#F0F7F2',
};

type SearchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'results'; venues: VenueSearchResult[] }
  | { kind: 'empty' }
  | { kind: 'submitted'; venueName: string };

export default function WorkplaceSearchScreen() {
  const [query, setQuery] = useState('');
  const [searchState, setSearchState] = useState<SearchState>({ kind: 'idle' });
  const [submitting, setSubmitting] = useState<string | null>(null); // venueId being submitted

  const search = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setSearchState({ kind: 'loading' });
    try {
      const { venues } = await appApi.searchVenues(q);
      setSearchState(venues.length > 0 ? { kind: 'results', venues } : { kind: 'empty' });
    } catch (e) {
      Alert.alert('Search failed', e instanceof Error ? e.message : 'Try again.');
      setSearchState({ kind: 'idle' });
    }
  }, [query]);

  const requestJoin = async (venue: VenueSearchResult) => {
    setSubmitting(venue.id);
    try {
      await appApi.submitJoinRequest({ venueId: venue.id });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace({
        pathname: '/(auth)/join-pending',
        params: { venueName: venue.name },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not submit request. Try again.';
      Alert.alert('Request failed', msg);
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={{ flex: 1, padding: spacing.lg, gap: spacing.md, paddingTop: spacing.xl }}>
        {/* Progress */}
        <View style={styles.stepRow}>
          <View style={[styles.step, styles.stepDone]} />
          <View style={[styles.step, styles.stepActive]} />
        </View>

        <View style={{ gap: 4 }}>
          <Text variant="headlineMedium" style={{ color: colors.text, fontWeight: '700' }}>
            Find your workplace
          </Text>
          <Text variant="bodyMedium" style={{ color: colors.muted }}>
            Search by business name, address, or workplace code.
          </Text>
        </View>

        {/* Search bar */}
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <TextInput
            outlineColor={colors.border}
            activeOutlineColor={colors.primary}
            textColor={colors.text}
            placeholderTextColor={colors.muted}
            style={{ flex: 1, backgroundColor: colors.surface }}
            label="Search"
            value={query}
            onChangeText={(v) => {
              setQuery(v);
              if (searchState.kind !== 'idle') setSearchState({ kind: 'idle' });
            }}
            mode="outlined"
            returnKeyType="search"
            onSubmitEditing={() => void search()}
          />
          <Button
            mode="contained"
            buttonColor={colors.primary}
            textColor={colors.buttonText}
            onPress={() => void search()}
            style={{ alignSelf: 'center' }}
            disabled={!query.trim()}
          >
            Search
          </Button>
        </View>

        {/* Results */}
        {searchState.kind === 'loading' && (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={colors.primary} />
            <Text style={{ color: colors.muted, marginTop: spacing.sm }}>Searching…</Text>
          </View>
        )}

        {searchState.kind === 'empty' && (
          <Card style={styles.card}>
            <Card.Content style={{ gap: spacing.sm, alignItems: 'center', paddingVertical: spacing.lg }}>
              <Text variant="titleMedium" style={{ color: colors.text }}>
                No workplaces found
              </Text>
              <Text variant="bodySmall" style={{ color: colors.muted, textAlign: 'center' }}>
                Try a different name, address, or ask your manager for the workplace code.
              </Text>
              <Button mode="outlined" textColor={colors.primary} onPress={() => setSearchState({ kind: 'idle' })}>
                Clear search
              </Button>
            </Card.Content>
          </Card>
        )}

        {searchState.kind === 'results' && (
          <FlatList
            data={searchState.venues}
            keyExtractor={(item) => item.id}
            ItemSeparatorComponent={() => <Divider />}
            style={styles.resultsList}
            contentContainerStyle={{ borderRadius: 14, overflow: 'hidden' }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.resultRow}
                onPress={() => void requestJoin(item)}
                disabled={submitting === item.id}
              >
                <View style={{ flex: 1 }}>
                  <Text variant="titleSmall" style={{ color: colors.text, fontWeight: '600' }}>
                    {item.name}
                  </Text>
                  {item.address ? (
                    <Text variant="bodySmall" style={{ color: colors.muted }}>
                      {item.address}
                    </Text>
                  ) : null}
                  {item.code ? (
                    <Text variant="labelSmall" style={{ color: colors.muted }}>
                      Code: {item.code}
                    </Text>
                  ) : null}
                </View>
                {submitting === item.id ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 13 }}>
                    Request to join
                  </Text>
                )}
              </TouchableOpacity>
            )}
          />
        )}

        {searchState.kind === 'idle' && (
          <View style={{ flex: 1 }} />
        )}

        <Button mode="text" textColor={colors.muted} onPress={() => router.back()}>
          Back
        </Button>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  stepRow: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  step: { flex: 1, height: 4, borderRadius: 2, backgroundColor: '#E8E2D8' },
  stepActive: { backgroundColor: '#2F7D46' },
  stepDone: { backgroundColor: '#A8CBB0' },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E8E2D8',
  },
  resultsList: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E8E2D8',
    flexGrow: 0,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: '#FFFFFF',
    gap: spacing.sm,
  },
});
