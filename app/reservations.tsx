import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, Chip, IconButton, Text, TextInput } from 'react-native-paper';
import { router } from 'expo-router';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import { accents, colors, spacing } from '../lib/theme';
import { useAuthStore, type AuthState } from '../lib/auth-store';

const reservationSources = ['direct', 'opentable', 'resy', 'phone', 'walk_in'] as const;
type Source = (typeof reservationSources)[number];

type ReservationRow = {
  id: string;
  guestName: string;
  partySize: number;
  reservationTime: number;
  durationMinutes: number;
  source: string;
  status: string;
  tags: string[];
  specialRequests: string | null;
  notes: string | null;
};

type FloorTable = {
  table: { _id: string; label: string; section: string; seats: number; isReservable?: boolean };
  state: { status: string } | null;
};

const statusColor: Record<string, { bg: string; fg: string }> = {
  requested: { bg: accents[4].bg, fg: accents[4].fg },
  confirmed: { bg: accents[0].bg, fg: accents[0].fg },
  checked_in: { bg: accents[3].bg, fg: accents[3].fg },
  seated: { bg: accents[2].bg, fg: accents[2].fg },
  completed: { bg: colors.cream, fg: colors.muted },
  no_show: { bg: '#FDE7E9', fg: colors.danger },
  cancelled: { bg: '#FDE7E9', fg: colors.danger },
};

function fmtResTime(at: number) {
  return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function fmtDay(at: number) {
  return new Date(at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
function pad(n: number) {
  return n.toString().padStart(2, '0');
}

export default function ReservationsScreen() {
  const venue = useAuthStore((state: AuthState) => state.venue);
  const user = useAuthStore((state: AuthState) => state.user);
  const canManage = user?.role === 'admin' || user?.role === 'owner' || user?.role === 'manager';

  const page = useQuery(api.reservations.getReservationsPage, venue?.id ? { venueId: venue.id } : 'skip') as any;
  const floor = useQuery(api.floorBinding.getActiveFloorPlan, venue?.id ? { venueId: venue.id } : 'skip') as any;
  const waitlistData = useQuery(api.floorBinding.getOpenWaitlist, venue?.id ? { venueId: venue.id } : 'skip') as any;
  const saveReservation = useMutation(api.reservations.saveReservation);
  const removeReservation = useMutation(api.reservations.removeReservation);
  const assignReservation = useMutation(api.floorBinding.assignReservationToTables);
  const addToWaitlist = useMutation(api.floorBinding.addToWaitlist);
  const markWaitlistReady = useMutation(api.floorBinding.markWaitlistReady);
  const removeFromWaitlist = useMutation(api.floorBinding.removeFromWaitlist);
  const assignWaitlist = useMutation(api.floorBinding.assignWaitlistToTables);

  // Waitlist form/state
  const [wlName, setWlName] = useState('');
  const [wlParty, setWlParty] = useState(2);
  const [wlPhone, setWlPhone] = useState('');
  const [seatingWaitlistId, setSeatingWaitlistId] = useState<string | null>(null);
  const waitlist = useMemo(() => (waitlistData ?? []) as Array<{ id: string; guestName: string; partySize: number; requestedAt: number; readyAt: number | null; notes: string | null }>, [waitlistData]);

  const addWalkIn = async () => {
    if (!venue?.id || !wlName.trim()) return;
    await addToWaitlist({ venueId: venue.id, guestName: wlName.trim(), partySize: wlParty, guestPhone: wlPhone.trim() || undefined });
    setWlName('');
    setWlPhone('');
    setWlParty(2);
  };

  const seatWaitlist = async (entryId: string, tableId: string) => {
    if (!venue?.id) return;
    setWaitlistError(null);
    try {
      const startsAt = Date.now();
      await assignWaitlist({ venueId: venue.id, waitlistId: entryId as Id<'waitlist'>, tableIds: [tableId as Id<'tables'>], holdType: 'seated', startsAt, endsAt: startsAt + 120 * 60 * 1000 });
      setSeatingWaitlistId(null);
    } catch (e) {
      setWaitlistError(e instanceof Error ? e.message : 'Failed to seat guest');
    }
  };

  const handleMarkWaitlistReady = async (waitlistId: string) => {
    if (!venue?.id) return;
    setWaitlistError(null);
    try {
      await markWaitlistReady({ venueId: venue.id, waitlistId: waitlistId as Id<'waitlist'> });
    } catch (e) {
      setWaitlistError(e instanceof Error ? e.message : 'Failed to mark ready');
    }
  };

  const handleRemoveFromWaitlist = async (waitlistId: string) => {
    if (!venue?.id) return;
    setWaitlistError(null);
    try {
      await removeFromWaitlist({ venueId: venue.id, waitlistId: waitlistId as Id<'waitlist'> });
    } catch (e) {
      setWaitlistError(e instanceof Error ? e.message : 'Failed to remove');
    }
  };

  const reservations = useMemo(() => (page?.reservations ?? []) as ReservationRow[], [page]);
  const tables = useMemo(() => (floor?.tables ?? []) as FloorTable[], [floor]);
  const openTables = useMemo(
    () => tables.filter((t) => t.table.isReservable !== false && (!t.state || t.state.status === 'available' || t.state.status === 'dirty')),
    [tables],
  );

  // New reservation form
  const now = new Date();
  const [showForm, setShowForm] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [partySize, setPartySize] = useState(2);
  const [date, setDate] = useState(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
  const [time, setTime] = useState(`${pad((now.getHours() + 1) % 24)}:00`);
  const [source, setSource] = useState<Source>('direct');
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [waitlistError, setWaitlistError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [assigningId, setAssigningId] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...reservations].sort((a, b) => a.reservationTime - b.reservationTime),
    [reservations],
  );

  const createReservation = async () => {
    setError(null);
    if (!venue?.id || !guestName.trim()) {
      setError('Enter a guest name.');
      return;
    }
    const ts = new Date(`${date}T${time}:00`).getTime();
    if (Number.isNaN(ts)) {
      setError('Enter a valid date (YYYY-MM-DD) and time (HH:MM).');
      return;
    }
    try {
      await saveReservation({
        venueId: venue.id,
        guestName: guestName.trim(),
        guestPhone: guestPhone.trim() || undefined,
        guestEmail: guestEmail.trim() || undefined,
        partySize,
        reservationTime: ts,
        durationMinutes: 120,
        source,
        status: 'confirmed',
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        specialRequests: notes.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setGuestName('');
      setGuestPhone('');
      setGuestEmail('');
      setTags('');
      setNotes('');
      setPartySize(2);
      setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create reservation.');
    }
  };

  const assignToTable = async (res: ReservationRow, tableId: string, seat: boolean) => {
    if (!venue?.id) return;
    const startsAt = res.reservationTime;
    const endsAt = startsAt + (res.durationMinutes || 120) * 60 * 1000;
    await assignReservation({
      venueId: venue.id,
      reservationId: res.id as Id<'reservations'>,
      tableIds: [tableId as Id<'tables'>],
      holdType: seat ? 'seated' : 'reserved',
      startsAt,
      endsAt,
    });
    setAssigningId(null);
  };

  const deleteReservation = async (res: ReservationRow) => {
    if (!venue?.id) return;
    setDeleteError(null);
    try {
      await removeReservation({ venueId: venue.id, reservationId: res.id as Id<'reservations'> });
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Could not delete reservation.');
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ gap: 4, flex: 1 }}>
          <Text variant="headlineMedium" style={{ color: colors.primary, fontWeight: '800' }}>Reservations</Text>
          <Text style={{ color: colors.muted }}>Book guests and seat them on the floor at {venue?.name ?? 'your venue'}.</Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 }}>
          <Button compact mode="text" textColor={colors.primary} icon="floor-plan" onPress={() => router.push('/floor')}>Floor</Button>
          {canManage ? (
            <Button compact mode="text" textColor={colors.primary} icon="account-heart-outline" onPress={() => router.push('/guests')}>Guests</Button>
          ) : null}
        </View>
      </View>

      {/* Stats */}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {[
          { label: 'Active', value: page?.activeCount ?? 0, a: accents[2] },
          { label: 'Upcoming', value: page?.upcomingCount ?? 0, a: accents[0] },
          { label: 'Cancelled', value: page?.cancelledCount ?? 0, a: accents[1] },
        ].map((s) => (
          <Card key={s.label} style={{ flex: 1, backgroundColor: s.a.bg, borderRadius: 16 }}>
            <Card.Content style={{ gap: 2 }}>
              <Text style={{ color: s.a.fg, fontSize: 24, fontWeight: '800' }}>{s.value}</Text>
              <Text style={{ color: colors.muted }}>{s.label}</Text>
            </Card.Content>
          </Card>
        ))}
      </View>

      {/* Waitlist */}
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Waitlist</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <TextInput label="Walk-in name" value={wlName} onChangeText={setWlName} mode="outlined" dense style={{ flex: 1, backgroundColor: colors.surface }} />
            <IconButton icon="minus" mode="outlined" size={16} onPress={() => setWlParty((p) => Math.max(1, p - 1))} />
            <Text style={{ minWidth: 20, textAlign: 'center' }}>{wlParty}</Text>
            <IconButton icon="plus" mode="outlined" size={16} onPress={() => setWlParty((p) => Math.min(30, p + 1))} />
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TextInput label="Phone (optional)" value={wlPhone} onChangeText={setWlPhone} mode="outlined" dense keyboardType="phone-pad" style={{ flex: 1, backgroundColor: colors.surface }} />
            <Button mode="contained" buttonColor={colors.primary} onPress={() => void addWalkIn()}>Add</Button>
          </View>
          {waitlistError ? <Text style={{ color: colors.danger }}>{waitlistError}</Text> : null}
          {waitlist.length === 0 ? (
            <Text style={{ color: colors.muted }}>No one waiting.</Text>
          ) : (
            waitlist.map((w) => {
              const waitMins = Math.max(0, Math.round((Date.now() - w.requestedAt) / 60000));
              return (
                <View key={w.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 6 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontWeight: '700' }}>{w.guestName} · party of {w.partySize}</Text>
                    {w.readyAt ? <Chip compact style={{ backgroundColor: accents[2].bg }} textStyle={{ color: accents[2].fg }}>Ready</Chip> : <Text style={{ color: colors.muted }}>{waitMins}m waiting</Text>}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    {!w.readyAt ? <Button compact mode="outlined" textColor={accents[2].fg} onPress={() => void handleMarkWaitlistReady(w.id)}>Mark ready</Button> : null}
                    <Button compact mode={seatingWaitlistId === w.id ? 'contained' : 'outlined'} buttonColor={seatingWaitlistId === w.id ? colors.primary : undefined} textColor={seatingWaitlistId === w.id ? '#fff' : colors.primary} onPress={() => setSeatingWaitlistId(seatingWaitlistId === w.id ? null : w.id)}>
                      {seatingWaitlistId === w.id ? 'Pick a table…' : 'Seat'}
                    </Button>
                    <Button compact mode="text" textColor={colors.danger} onPress={() => void handleRemoveFromWaitlist(w.id)}>Remove</Button>
                  </View>
                  {seatingWaitlistId === w.id ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, backgroundColor: colors.background, borderRadius: 12, padding: 10 }}>
                      {openTables.length === 0 ? (
                        <Text style={{ color: colors.danger }}>No open tables.</Text>
                      ) : (
                        openTables.map((t) => (
                          <Chip key={t.table._id} onPress={() => void seatWaitlist(w.id, t.table._id)}>{t.table.label} · {t.table.seats}</Chip>
                        ))
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </Card.Content>
      </Card>

      {/* New reservation */}
      {canManage ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="titleMedium" style={{ fontWeight: '700' }}>New reservation</Text>
              <Button compact mode={showForm ? 'text' : 'contained'} buttonColor={showForm ? undefined : colors.primary} onPress={() => setShowForm((v) => !v)}>
                {showForm ? 'Close' : 'Add'}
              </Button>
            </View>
            {showForm ? (
              <>
                <TextInput label="Guest name" value={guestName} onChangeText={setGuestName} mode="outlined" style={{ backgroundColor: colors.surface }} />
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <TextInput label="Phone" value={guestPhone} onChangeText={setGuestPhone} mode="outlined" keyboardType="phone-pad" style={{ flex: 1, backgroundColor: colors.surface }} />
                  <TextInput label="Email" value={guestEmail} onChangeText={setGuestEmail} mode="outlined" keyboardType="email-address" autoCapitalize="none" style={{ flex: 1, backgroundColor: colors.surface }} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ width: 64 }}>Party</Text>
                  <IconButton icon="minus" mode="outlined" size={16} onPress={() => setPartySize((p) => Math.max(1, p - 1))} />
                  <Text style={{ minWidth: 28, textAlign: 'center' }}>{partySize}</Text>
                  <IconButton icon="plus" mode="outlined" size={16} onPress={() => setPartySize((p) => Math.min(30, p + 1))} />
                </View>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <TextInput label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} mode="outlined" autoCapitalize="none" style={{ flex: 1, backgroundColor: colors.surface }} />
                  <TextInput label="Time (HH:MM)" value={time} onChangeText={setTime} mode="outlined" autoCapitalize="none" style={{ flex: 1, backgroundColor: colors.surface }} />
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {reservationSources.map((s) => (
                    <Chip key={s} selected={source === s} onPress={() => setSource(s)}>{s.replace('_', ' ')}</Chip>
                  ))}
                </View>
                <TextInput label="Tags (comma separated)" value={tags} onChangeText={setTags} mode="outlined" style={{ backgroundColor: colors.surface }} />
                <TextInput label="Notes / requests" value={notes} onChangeText={setNotes} mode="outlined" multiline style={{ backgroundColor: colors.surface }} />
                {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
                <Button mode="contained" buttonColor={colors.primary} onPress={() => void createReservation()}>Create reservation</Button>
              </>
            ) : null}
          </Card.Content>
        </Card>
      ) : null}

      {/* Reservation list */}
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Bookings</Text>
          {deleteError ? <Text style={{ color: colors.danger }}>{deleteError}</Text> : null}
          {page === undefined ? (
            <Text style={{ color: colors.muted }}>Loading…</Text>
          ) : sorted.length === 0 ? (
            <Text style={{ color: colors.muted }}>No reservations yet.</Text>
          ) : (
            sorted.map((res) => {
              const sc = statusColor[res.status] ?? { bg: colors.cream, fg: colors.muted };
              const seated = res.status === 'seated';
              const cancelled = res.status === 'cancelled' || res.status === 'no_show' || res.status === 'completed';
              return (
                <View key={res.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 6 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontWeight: '800' }}>{fmtResTime(res.reservationTime)}</Text>
                    <Chip compact style={{ backgroundColor: sc.bg }} textStyle={{ color: sc.fg }}>{res.status.replace('_', ' ')}</Chip>
                  </View>
                  <Text>{res.guestName} · party of {res.partySize}</Text>
                  <Text style={{ color: colors.muted }}>{fmtDay(res.reservationTime)} · {res.source.replace('_', ' ')}</Text>

                  {res.notes || res.specialRequests ? <Text style={{ color: colors.muted }}>{res.notes ?? res.specialRequests}</Text> : null}
                  {res.tags?.length ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {res.tags.map((tag) => (
                        <Chip key={tag} compact>{tag}</Chip>
                      ))}
                    </View>
                  ) : null}

                  {canManage ? (
                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                      {!seated && !cancelled ? (
                        <Button compact mode={assigningId === res.id ? 'contained' : 'outlined'} buttonColor={assigningId === res.id ? colors.primary : undefined} textColor={assigningId === res.id ? '#fff' : colors.primary} onPress={() => setAssigningId(assigningId === res.id ? null : res.id)}>
                          {assigningId === res.id ? 'Pick a table…' : 'Assign table'}
                        </Button>
                      ) : null}
                      <Button compact mode="text" textColor={colors.danger} icon="delete-outline" onPress={() => void deleteReservation(res)}>Delete</Button>
                    </View>
                  ) : null}

                  {assigningId === res.id ? (
                    <View style={{ gap: 6, backgroundColor: colors.background, borderRadius: 12, padding: 10 }}>
                      <Text style={{ color: colors.muted }}>Tap an open table to reserve, or long-actions to seat now:</Text>
                      {openTables.length === 0 ? (
                        <Text style={{ color: colors.danger }}>No open tables. Build/seed a floor plan first.</Text>
                      ) : (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                          {openTables.map((t) => (
                            <View key={t.table._id} style={{ gap: 4, alignItems: 'center' }}>
                              <Chip onPress={() => void assignToTable(res, t.table._id, false)}>
                                {t.table.label} · {t.table.seats}
                              </Chip>
                              <Button compact mode="text" textColor={accents[2].fg} onPress={() => void assignToTable(res, t.table._id, true)}>Seat</Button>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </Card.Content>
      </Card>
    </ScrollView>
  );
}
