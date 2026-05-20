import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, Chip, Text, TextInput as PaperTextInput } from 'react-native-paper';
import { useMutation, useQuery } from 'convex/react';
import { useRouter } from 'expo-router';
import { api } from '../convex/_generated/api';
import { colors, spacing } from '../lib/theme';
import { useAuthStore, type AuthState } from '../lib/auth-store';

const sourceFilters = ['all', 'direct', 'opentable', 'resy', 'phone', 'walk_in'] as const;
const reservationStatuses = ['requested', 'confirmed', 'checked_in', 'seated', 'completed', 'no_show', 'cancelled'] as const;

type ReservationRow = {
  id: string;
  guestName: string;
  partySize: number;
  reservationTime: number;
  durationMinutes: number;
  source: string;
  tags: string[];
  specialRequests: string | null;
  status: string;
  externalId: string | null;
  guestPhone: string | null;
  guestEmail: string | null;
  notes: string | null;
};

type ReservationSettings = {
  defaultDiningMinutes: number;
  defaultTurnMinutes: number;
  bookingWindowDays: number;
  minLeadHours: number;
};

type TableRow = {
  _id: string;
  label: string;
  seats: number;
};

type WaitlistRow = {
  id: string;
  guestName: string;
  partySize: number;
  requestedAt: number;
  source: string;
  status: string;
  notes: string | null;
};

function formatTime(value: number) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function ReservationsScreen() {
  const router = useRouter();
  const venue = useAuthStore((state: AuthState) => state.venue);
  const user = useAuthStore((state: AuthState) => state.user);
  const [sourceFilter, setSourceFilter] = useState<(typeof sourceFilters)[number]>('all');
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [selectedReservationId, setSelectedReservationId] = useState<string | null>(null);
  const [selectedWaitlistId, setSelectedWaitlistId] = useState<string | null>(null);

  const floor = useQuery(api.floorBinding.getActiveFloorPlan, venue?.id ? { venueId: venue.id } : 'skip') as
    | { floorPlan: { name: string }; tables: Array<{ table: TableRow }> }
    | null
    | undefined;
  const reservations = useQuery(api.floorBinding.getUnassignedReservations, venue?.id ? { venueId: venue.id, withinMinutes: 240 } : 'skip') as
    | ReservationRow[]
    | null
    | undefined;
  const waitlist = useQuery(api.floorBinding.getOpenWaitlist, venue?.id ? { venueId: venue.id } : 'skip') as
    | WaitlistRow[]
    | null
    | undefined;

  const assignReservation = useMutation(api.floorBinding.assignReservationToTables);
  const assignWaitlist = useMutation(api.floorBinding.assignWaitlistToTables);

  const page = useQuery(api.reservations.getReservationsPage, venue?.id ? { venueId: venue.id } : 'skip') as
    | {
        settings: ReservationSettings | null;
        reservations: ReservationRow[];
        activeCount: number;
        upcomingCount: number;
        cancelledCount: number;
      }
    | null
    | undefined;

  const saveReservation = useMutation(api.reservations.saveReservation);
  const saveReservationSettings = useMutation(api.reservations.saveReservationSettings);
  const removeReservation = useMutation(api.reservations.removeReservation);

  const canEdit = user?.role === 'admin' || user?.role === 'owner' || user?.role === 'manager';
  const reservationsData = useMemo(() => page?.reservations ?? [], [page?.reservations]);
  const settings = page?.settings ?? null;
  const [editingReservationId, setEditingReservationId] = useState<string | null>(null);
  const editingReservation = useMemo(() => reservationsData.find((item: ReservationRow) => item.id === editingReservationId) ?? null, [editingReservationId, reservationsData]);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [partySize, setPartySize] = useState('2');
  const [reservationTime, setReservationTime] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('120');
  const [source, setSource] = useState<(typeof sourceFilters)[number]>('direct');
  const [status, setStatus] = useState<(typeof reservationStatuses)[number]>('confirmed');
  const [specialRequests, setSpecialRequests] = useState('');
  const [notes, setNotes] = useState('');
  const [defaultDiningMinutes, setDefaultDiningMinutes] = useState(String(page?.settings?.defaultDiningMinutes ?? 120));
  const [defaultTurnMinutes, setDefaultTurnMinutes] = useState(String(page?.settings?.defaultTurnMinutes ?? 20));
  const [bookingWindowDays, setBookingWindowDays] = useState(String(page?.settings?.bookingWindowDays ?? 14));
  const [minLeadHours, setMinLeadHours] = useState(String(page?.settings?.minLeadHours ?? 2));

  useEffect(() => {
    if (!editingReservation) return;
    setGuestName(editingReservation.guestName);
    setGuestPhone(editingReservation.guestPhone ?? '');
    setGuestEmail(editingReservation.guestEmail ?? '');
    setPartySize(String(editingReservation.partySize));
    setReservationTime(String(editingReservation.reservationTime));
    setDurationMinutes(String(editingReservation.durationMinutes));
    setSource(editingReservation.source as (typeof sourceFilters)[number]);
    setStatus(editingReservation.status as (typeof reservationStatuses)[number]);
    setSpecialRequests(editingReservation.specialRequests ?? '');
    setNotes(editingReservation.notes ?? '');
  }, [editingReservation]);

  useEffect(() => {
    setDefaultDiningMinutes(String(settings?.defaultDiningMinutes ?? 120));
    setDefaultTurnMinutes(String(settings?.defaultTurnMinutes ?? 20));
    setBookingWindowDays(String(settings?.bookingWindowDays ?? 14));
    setMinLeadHours(String(settings?.minLeadHours ?? 2));
  }, [settings]);

  const onSaveReservation = async () => {
    if (!venue?.id || !canEdit) return;
    await saveReservation({
      venueId: venue.id,
      reservationId: editingReservationId ?? undefined,
      guestName,
      guestPhone: guestPhone || undefined,
      guestEmail: guestEmail || undefined,
      partySize: Number(partySize),
      reservationTime: Number(reservationTime),
      durationMinutes: Number(durationMinutes),
      source,
      status,
      specialRequests: specialRequests || undefined,
      notes: notes || undefined,
      tags: [],
    });
    setEditingReservationId(null);
  };

  const onSaveRules = async () => {
    if (!venue?.id || !canEdit) return;
    await saveReservationSettings({
      venueId: venue.id,
      defaultDiningMinutes: Number(defaultDiningMinutes),
      defaultTurnMinutes: Number(defaultTurnMinutes),
      bookingWindowDays: Number(bookingWindowDays),
      minLeadHours: Number(minLeadHours),
    });
  };

  const onRemoveReservation = async (id: string) => {
    if (!venue?.id || !canEdit) return;
    await removeReservation({ venueId: venue.id, reservationId: id as never });
  };

  const tables = floor?.tables ?? [];
  const reservationRows = useMemo(
    () => reservationsData.filter((item: ReservationRow) => sourceFilter === 'all' || item.source === sourceFilter),
    [reservationsData, sourceFilter],
  );
  const waitlistRows = waitlist ?? [];
  const selectedTable = tables.find((item: { table: TableRow }) => item.table._id === selectedTableId) ?? null;
  const selectedReservation = reservationRows.find((item: ReservationRow) => item.id === selectedReservationId) ?? reservationRows[0] ?? null;
  const selectedWaitlist = waitlistRows.find((item: WaitlistRow) => item.id === selectedWaitlistId) ?? waitlistRows[0] ?? null;

  const assignToSelectedTable = async (reservation: ReservationRow | WaitlistRow, type: 'reservation' | 'waitlist') => {
    if (!venue?.id || !selectedTable || !canEdit) return;
    const startsAt = 'reservationTime' in reservation ? reservation.reservationTime : reservation.requestedAt;
    const endsAt = startsAt + ('durationMinutes' in reservation ? reservation.durationMinutes : 120) * 60 * 1000;
    if (type === 'reservation') {
      await assignReservation({
        venueId: venue.id,
        reservationId: reservation.id as never,
        tableIds: [selectedTable.table._id as never],
        holdType: 'reserved',
        startsAt,
        endsAt,
        actorRole: user?.role ?? 'staff',
      });
      setSelectedReservationId(null);
    } else {
      await assignWaitlist({
        venueId: venue.id,
        waitlistId: reservation.id as never,
        tableIds: [selectedTable.table._id as never],
        holdType: 'held',
        startsAt,
        endsAt,
        actorRole: user?.role ?? 'staff',
      });
      setSelectedWaitlistId(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md }}>
      <View style={{ gap: 4 }}>
        <Text variant="headlineMedium" style={{ color: colors.primary, fontFamily: 'serif' }}>
          Reservations
        </Text>
        <Text style={{ color: colors.muted }}>
          Assign queue items to tables and track upcoming holds for {venue?.name ?? 'your venue'}.
        </Text>
      </View>

      <Card style={{ backgroundColor: colors.surface }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <View>
              <Text variant="titleMedium">Need assignment</Text>
              <Text style={{ color: colors.muted }}>{reservationRows.length} reservations · {waitlistRows.length} waitlist entries</Text>
            </View>
            <Button mode="text" textColor={colors.primary} onPress={() => router.push('/floor')}>
              Open floor
            </Button>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {sourceFilters.map((filter) => (
              <Chip key={filter} selected={sourceFilter === filter} onPress={() => setSourceFilter(filter)}>
                {filter === 'all' ? 'All' : filter.replace('_', ' ')}
              </Chip>
            ))}
          </ScrollView>
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium">Choose a table</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {tables.map(({ table }: { table: TableRow }) => (
              <Chip key={table._id} selected={selectedTableId === table._id} onPress={() => setSelectedTableId(table._id)}>
                {table.label} · {table.seats}
              </Chip>
            ))}
          </ScrollView>
          <Text style={{ color: colors.muted }}>
            {selectedTable ? `Assign items to ${selectedTable.table.label}` : 'Select a table to enable assignment.'}
          </Text>
        </Card.Content>
      </Card>

      {selectedReservation ? (
        <Card style={{ backgroundColor: colors.surface }}>
          <Card.Content style={{ gap: 6 }}>
            <Text variant="titleMedium">Focused reservation</Text>
            <Text>{selectedReservation.guestName} · {selectedReservation.partySize} guests</Text>
            <Text style={{ color: colors.muted }}>{formatTime(selectedReservation.reservationTime)} · {selectedReservation.source}</Text>
          </Card.Content>
        </Card>
      ) : null}

      {selectedWaitlist ? (
        <Card style={{ backgroundColor: colors.surface }}>
          <Card.Content style={{ gap: 6 }}>
            <Text variant="titleMedium">Focused waitlist</Text>
            <Text>{selectedWaitlist.guestName} · {selectedWaitlist.partySize} guests</Text>
            <Text style={{ color: colors.muted }}>{formatTime(selectedWaitlist.requestedAt)} · {selectedWaitlist.source}</Text>
          </Card.Content>
        </Card>
      ) : null}

      <Card style={{ backgroundColor: colors.surface }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium">Reservation rules</Text>
          <PaperTextInput label="Default dining minutes" value={defaultDiningMinutes} onChangeText={setDefaultDiningMinutes} mode="outlined" keyboardType="numeric" />
          <PaperTextInput label="Default turn minutes" value={defaultTurnMinutes} onChangeText={setDefaultTurnMinutes} mode="outlined" keyboardType="numeric" />
          <PaperTextInput label="Booking window days" value={bookingWindowDays} onChangeText={setBookingWindowDays} mode="outlined" keyboardType="numeric" />
          <PaperTextInput label="Minimum lead hours" value={minLeadHours} onChangeText={setMinLeadHours} mode="outlined" keyboardType="numeric" />
          {canEdit ? (
            <Button mode="contained" buttonColor={colors.primary} onPress={() => void onSaveRules()}>
              Save rules
            </Button>
          ) : null}
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium">Edit reservation</Text>
          <PaperTextInput label="Guest name" value={guestName} onChangeText={setGuestName} mode="outlined" />
          <PaperTextInput label="Guest phone" value={guestPhone} onChangeText={setGuestPhone} mode="outlined" />
          <PaperTextInput label="Guest email" value={guestEmail} onChangeText={setGuestEmail} mode="outlined" />
          <PaperTextInput label="Party size" value={partySize} onChangeText={setPartySize} mode="outlined" keyboardType="numeric" />
          <PaperTextInput label="Reservation time (ms)" value={reservationTime} onChangeText={setReservationTime} mode="outlined" keyboardType="numeric" />
          <PaperTextInput label="Dining minutes" value={durationMinutes} onChangeText={setDurationMinutes} mode="outlined" keyboardType="numeric" />
          <PaperTextInput label="Special requests" value={specialRequests} onChangeText={setSpecialRequests} mode="outlined" multiline />
          <PaperTextInput label="Notes" value={notes} onChangeText={setNotes} mode="outlined" multiline />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {sourceFilters.filter((item) => item !== 'all').map((item) => (
              <Chip key={item} selected={source === item} onPress={() => setSource(item)}>{item}</Chip>
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {reservationStatuses.map((item) => (
              <Chip key={item} selected={status === item} onPress={() => setStatus(item)}>{item}</Chip>
            ))}
          </View>
          {canEdit ? (
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Button mode="contained" buttonColor={colors.primary} onPress={() => void onSaveReservation()}>
                {editingReservationId ? 'Update reservation' : 'Create reservation'}
              </Button>
              <Button mode="text" textColor={colors.primary} onPress={() => setEditingReservationId(null)}>
                Clear
              </Button>
            </View>
          ) : null}
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium">Reservations</Text>
          {reservationsData.map((reservation: ReservationRow) => (
            <Card key={reservation.id} style={{ backgroundColor: '#201812' }}>
              <Card.Content style={{ gap: 6 }}>
                <Text style={{ color: colors.cream, fontWeight: '700' }}>{reservation.guestName}</Text>
                <Text style={{ color: colors.cream, fontSize: 12 }}>
                  {reservation.partySize} guests · {formatTime(reservation.reservationTime)} · {reservation.source}
                </Text>
                <Text style={{ color: colors.cream, fontSize: 12 }}>
                  Dining {reservation.durationMinutes} min · {reservation.status}
                </Text>
                <Text style={{ color: colors.cream, fontSize: 12 }}>
                  {reservation.specialRequests ?? 'No special requests'}
                </Text>
                {canEdit ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <Button mode="contained" buttonColor={colors.primary} onPress={() => setEditingReservationId(reservation.id)}>
                      Edit
                    </Button>
                    <Button mode="outlined" textColor={colors.primary} onPress={() => void onRemoveReservation(reservation.id)}>
                      Remove
                    </Button>
                  </View>
                ) : null}
              </Card.Content>
            </Card>
          ))}
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium">Waitlist</Text>
          {waitlistRows.length === 0 ? (
            <Text style={{ color: colors.muted }}>No active waitlist entries.</Text>
          ) : (
            waitlistRows.map((item: WaitlistRow) => (
              <Card key={item.id} style={{ backgroundColor: '#201812' }}>
                <Card.Content style={{ gap: 6 }}>
                  <Text style={{ color: colors.cream, fontWeight: '700' }}>{item.guestName}</Text>
                  <Text style={{ color: colors.cream, fontSize: 12 }}>
                    {item.partySize} guests · {item.source} · {formatTime(item.requestedAt)}
                  </Text>
                  <Text style={{ color: colors.cream, fontSize: 12 }}>{item.notes ?? 'No notes'}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <Chip selected={selectedWaitlistId === item.id} onPress={() => setSelectedWaitlistId(item.id)}>
                      Focus
                    </Chip>
                    {canEdit ? (
                      <Button mode="contained" buttonColor={colors.primary} disabled={!selectedTable} onPress={() => void assignToSelectedTable(item, 'waitlist')}>
                        Hold on selected table
                      </Button>
                    ) : null}
                  </View>
                </Card.Content>
              </Card>
            ))
          )}
        </Card.Content>
      </Card>
    </ScrollView>
  );
}