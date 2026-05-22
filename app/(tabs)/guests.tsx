import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, Chip, Text, TextInput } from 'react-native-paper';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { accents, colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';

type GuestRow = {
  _id: Id<'guests'>;
  fullName: string;
  phone: string | null;
  email: string | null;
  tags: string[];
  notes: string | null;
  reservationCount: number;
  visitCount: number;
  lastVisitAt: number | null;
  upcomingReservationAt: number | null;
  totalSpendCents: number;
};

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function dateText(value: number | null) {
  return value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'None';
}

export default function GuestsScreen() {
  const venue = useAuthStore((state: AuthState) => state.venue);
  const user = useAuthStore((state: AuthState) => state.user);
  const canManage = user?.role === 'admin' || user?.role === 'owner' || user?.role === 'manager';
  const guests = useQuery(api.guests.listGuests, canManage && venue?.id ? { venueId: venue.id } : 'skip') as GuestRow[] | undefined;
  const upsertGuest = useMutation(api.guests.upsertGuest);

  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = guests ?? [];
    if (!q) return rows;
    return rows.filter((guest) =>
      [guest.fullName, guest.phone ?? '', guest.email ?? '', guest.tags.join(' ')].some((value) => value.toLowerCase().includes(q)),
    );
  }, [guests, query]);

  const saveGuest = async () => {
    if (!venue?.id || !fullName.trim()) {
      setError('Guest name is required.');
      return;
    }
    setError(null);
    try {
      await upsertGuest({
        venueId: venue.id,
        fullName: fullName.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        notes: notes.trim() || undefined,
      });
      setFullName('');
      setPhone('');
      setEmail('');
      setTags('');
      setNotes('');
      setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save guest.');
    }
  };

  if (!canManage) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={{ color: colors.muted }}>Guest CRM is available to managers and admins.</Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ gap: 4 }}>
        <Text variant="headlineMedium" style={{ color: colors.primary, fontWeight: '800' }}>Guest CRM</Text>
        <Text style={{ color: colors.muted }}>Profiles built from reservations and POS visits at {venue?.name ?? 'your venue'}.</Text>
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Card style={{ flex: 1, backgroundColor: accents[0].bg, borderRadius: 16 }}>
          <Card.Content>
            <Text style={{ color: accents[0].fg, fontSize: 26, fontWeight: '800' }}>{guests?.length ?? 0}</Text>
            <Text style={{ color: colors.muted }}>Guests</Text>
          </Card.Content>
        </Card>
        <Card style={{ flex: 1, backgroundColor: accents[2].bg, borderRadius: 16 }}>
          <Card.Content>
            <Text style={{ color: accents[2].fg, fontSize: 26, fontWeight: '800' }}>{guests?.reduce((sum, guest) => sum + guest.visitCount, 0) ?? 0}</Text>
            <Text style={{ color: colors.muted }}>Visits</Text>
          </Card.Content>
        </Card>
      </View>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>Guest directory</Text>
            <Button compact mode={showForm ? 'text' : 'contained'} buttonColor={showForm ? undefined : colors.primary} onPress={() => setShowForm((value) => !value)}>
              {showForm ? 'Close' : 'Add'}
            </Button>
          </View>
          <TextInput label="Search guests" value={query} onChangeText={setQuery} mode="outlined" style={{ backgroundColor: colors.surface }} />
          {showForm ? (
            <View style={{ gap: spacing.sm }}>
              <TextInput label="Full name" value={fullName} onChangeText={setFullName} mode="outlined" style={{ backgroundColor: colors.surface }} />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TextInput label="Phone" value={phone} onChangeText={setPhone} mode="outlined" keyboardType="phone-pad" style={{ flex: 1, backgroundColor: colors.surface }} />
                <TextInput label="Email" value={email} onChangeText={setEmail} mode="outlined" keyboardType="email-address" autoCapitalize="none" style={{ flex: 1, backgroundColor: colors.surface }} />
              </View>
              <TextInput label="Tags" value={tags} onChangeText={setTags} mode="outlined" style={{ backgroundColor: colors.surface }} />
              <TextInput label="Notes" value={notes} onChangeText={setNotes} mode="outlined" multiline style={{ backgroundColor: colors.surface }} />
              {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
              <Button mode="contained" buttonColor={colors.primary} onPress={() => void saveGuest()}>Save guest</Button>
            </View>
          ) : null}
        </Card.Content>
      </Card>

      {filtered.map((guest) => (
        <Card key={guest._id} style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text variant="titleMedium" style={{ fontWeight: '700' }}>{guest.fullName}</Text>
                <Text style={{ color: colors.muted }}>{guest.phone || guest.email || 'No contact on file'}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontWeight: '700' }}>{money(guest.totalSpendCents)}</Text>
                <Text style={{ color: colors.muted }}>POS spend</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {guest.tags.length > 0 ? guest.tags.map((tag) => <Chip compact key={tag}>{tag}</Chip>) : <Chip compact>No tags</Chip>}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              <Text style={{ color: colors.muted }}>{guest.reservationCount} reservations</Text>
              <Text style={{ color: colors.muted }}>{guest.visitCount} visits</Text>
              <Text style={{ color: colors.muted }}>Last: {dateText(guest.lastVisitAt)}</Text>
              <Text style={{ color: colors.muted }}>Next: {dateText(guest.upcomingReservationAt)}</Text>
            </View>
            {guest.notes ? <Text style={{ color: colors.charcoal }}>{guest.notes}</Text> : null}
          </Card.Content>
        </Card>
      ))}
    </ScrollView>
  );
}
