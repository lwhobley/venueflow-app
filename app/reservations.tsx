import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Button, Card, Chip, IconButton, Menu, Text, TextInput } from 'react-native-paper';
import { ScreenErrorBoundary } from '../components/ErrorBoundary';
import { router } from 'expo-router';
import { useMutation, useQuery } from '../lib/railway-hooks';
import { api } from '../lib/railway-api';
import type { Id } from '../lib/ids';
import { accents, colors, spacing } from '../lib/theme';
import { useAuthStore, type AuthState } from '../lib/auth-store';
import { useAuthenticatedSession } from '../lib/auth-readiness';
import { canManageVenue } from '../lib/permissions';
import { formatTime, formatShortDate, formatWeekdayDate, pad2, dollarsToCents, splitTags, errorMessage } from '../lib/format';
import { DateRangeBar, useDateRange } from '../components/DateRangeBar';

const reservationSources = ['direct', 'opentable', 'resy', 'phone', 'walk_in'] as const;
type Source = (typeof reservationSources)[number];

const MEAL_TIMES: Record<string, { label: string; time: string; duration: number }> = {
  breakfast: { label: 'Breakfast', time: '08:00', duration: 60 },
  brunch: { label: 'Brunch', time: '10:00', duration: 90 },
  lunch: { label: 'Lunch', time: '12:00', duration: 90 },
  dinner: { label: 'Dinner', time: '18:00', duration: 120 },
};

function getMealsForDayOfWeek(dow: number) {
  const isWeekend = dow === 0 || dow === 6;
  return isWeekend
    ? [MEAL_TIMES.brunch, MEAL_TIMES.dinner]
    : [MEAL_TIMES.breakfast, MEAL_TIMES.lunch, MEAL_TIMES.dinner];
}

type ReservationRow = {
  id: string;
  _id?: string;
  guestName: string;
  guestCompany?: string | null;
  partySize: number;
  reservationTime: number;
  durationMinutes: number;
  source: string;
  status: string;
  tags: string[];
  occasion?: string | null;
  specialRequests: string | null;
  notes: string | null;
  isPrivateEvent?: boolean;
  eventName?: string | null;
  eventStatus?: string | null;
  eventSpace?: string | null;
  setupStyle?: string | null;
  menuNotes?: string | null;
  beverageNotes?: string | null;
  billingNotes?: string | null;
  estimatedValueCents?: number | null;
  depositDueCents?: number | null;
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



export default function ReservationsScreenWrapper() {
  return <ScreenErrorBoundary><ReservationsScreen /></ScreenErrorBoundary>;
}

function ReservationsScreen() {
  const venue = useAuthStore((state: AuthState) => state.venue);
  const { isReady } = useAuthenticatedSession();
  const me = useQuery(api.app.getMe, isReady ? {} : 'skip');
  const canManage = Boolean(me && canManageVenue(me.profile.role, me.profile.allAccess));

  const page = useQuery(api.reservations.getReservationsPage, isReady && venue?.id ? { venueId: venue.id } : 'skip') as any;
  const floor = useQuery(api.floorBinding.getActiveFloorPlan, isReady && venue?.id ? { venueId: venue.id } : 'skip') as any;
  const waitlistData = useQuery(api.floorBinding.getOpenWaitlist, isReady && venue?.id ? { venueId: venue.id } : 'skip') as any;
  const holds = useQuery(api.reservations.listHolds, isReady && venue?.id ? { venueId: venue.id } : 'skip') as Array<{ id: string; startsAt: number; endsAt: number; reason: string }> | undefined;
  const saveReservation = useMutation(api.reservations.saveReservation);
  const removeReservation = useMutation(api.reservations.removeReservation);
  const assignReservation = useMutation(api.floorBinding.assignReservationToTables);
  const addToWaitlist = useMutation(api.floorBinding.addToWaitlist);
  const markWaitlistReady = useMutation(api.floorBinding.markWaitlistReady);
  const removeFromWaitlist = useMutation(api.floorBinding.removeFromWaitlist);
  const assignWaitlist = useMutation(api.floorBinding.assignWaitlistToTables);
  const createHold = useMutation(api.reservations.createHold);
  const deleteHold = useMutation(api.reservations.deleteHold);

  // Waitlist form/state
  const [wlName, setWlName] = useState('');
  const [wlParty, setWlParty] = useState(2);
  const [wlPhone, setWlPhone] = useState('');
  const [wlEmail, setWlEmail] = useState('');
  const [seatingWaitlistId, setSeatingWaitlistId] = useState<string | null>(null);
  const waitlist = useMemo(() => (waitlistData ?? []) as Array<{ id: string; guestName: string; partySize: number; requestedAt: number; readyAt: number | null; notes: string | null }>, [waitlistData]);

  const addWalkIn = async () => {
    if (!venue?.id || !wlName.trim()) return;
    await addToWaitlist({
      venueId: venue.id,
      guestName: wlName.trim(),
      partySize: wlParty,
      guestPhone: wlPhone.trim() || undefined,
      email: wlEmail.trim() || undefined,
    });
    setWlName('');
    setWlPhone('');
    setWlEmail('');
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
      setWaitlistError(errorMessage(e, 'Failed to seat guest'));
    }
  };

  const handleMarkWaitlistReady = async (waitlistId: string) => {
    if (!venue?.id) return;
    setWaitlistError(null);
    try {
      await markWaitlistReady({ venueId: venue.id, waitlistId: waitlistId as Id<'waitlist'> });
    } catch (e) {
      setWaitlistError(errorMessage(e, 'Failed to mark ready'));
    }
  };

  const handleRemoveFromWaitlist = async (waitlistId: string) => {
    if (!venue?.id) return;
    setWaitlistError(null);
    try {
      await removeFromWaitlist({ venueId: venue.id, waitlistId: waitlistId as Id<'waitlist'> });
    } catch (e) {
      setWaitlistError(errorMessage(e, 'Failed to remove'));
    }
  };

  const reservations = useMemo(
    () => ((page?.reservations ?? []) as ReservationRow[]).map((reservation) => ({ ...reservation, id: reservation.id ?? reservation._id ?? '' })),
    [page],
  );
  const tables = useMemo(() => (floor?.tables ?? []) as FloorTable[], [floor]);
  const openTables = useMemo(
    () => tables.filter((t) => t.table.isReservable !== false && (!t.state || t.state.status === 'available' || t.state.status === 'dirty')),
    [tables],
  );

  // New reservation form
  const now = new Date();
  const [showForm, setShowForm] = useState(false);
  const [showPrivateEventForm, setShowPrivateEventForm] = useState(false);
  const [guestFirstName, setGuestFirstName] = useState('');
  const [guestLastName, setGuestLastName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestCompany, setGuestCompany] = useState('');
  const [partySize, setPartySize] = useState(2);
  const [date, setDate] = useState(`${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`);
  const [time, setTime] = useState('18:00');
  const [selectedMeal, setSelectedMeal] = useState('dinner');
  const [dateMenuOpen, setDateMenuOpen] = useState(false);
  const [mealMenuOpen, setMealMenuOpen] = useState(false);
  const [source, setSource] = useState<Source>('direct');
  const [tags, setTags] = useState('');
  const [occasion, setOccasion] = useState('');
  const [notes, setNotes] = useState('');
  const [eventName, setEventName] = useState('');
  const [eventSpace, setEventSpace] = useState('');
  const [setupStyle, setSetupStyle] = useState('');
  const [menuNotes, setMenuNotes] = useState('');
  const [beverageNotes, setBeverageNotes] = useState('');
  const [billingNotes, setBillingNotes] = useState('');
  const [estimatedValue, setEstimatedValue] = useState('');
  const [depositDue, setDepositDue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [waitlistError, setWaitlistError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [assigningId, setAssigningId] = useState<string | null>(null);

  // Pacing chart bound to the create-form date so the manager sees the load
  // they're about to add to.
  const pacing = useQuery(
    api.reservations.getCoverPacing,
    isReady && venue?.id && date ? { venueId: venue.id, date } : 'skip',
  ) as { date: string; seatingCapacity: number; peakCovers: number; totalReservations: number; buckets: Array<{ startsAt: number; covers: number }> } | undefined;

  // Guest autofill: looks up an existing Guest by email or phone. Surfaces
  // preferences inline so hosts don't have to re-ask "do you still want
  // table 12?" every visit.
  const autofillKey = guestEmail.trim() || guestPhone.replace(/[^\d+]/g, '');
  const autofill = useQuery(
    api.reservations.guestAutofill,
    isReady && venue?.id && showForm && autofillKey.length >= 3
      ? { venueId: venue.id, email: guestEmail.trim() || undefined, phone: guestPhone.replace(/[^\d+]/g, '') || undefined }
      : 'skip',
  ) as { guest: { id: string; fullName: string; favoriteTable: string | null; preferredServer: string | null; dietaryNotes: string | null; tags: string[]; lifecycleStage: string | null; lastVisitAt: number | null; lastPartySize: number | null } | null } | undefined;

  // Hold form
  const [holdDate, setHoldDate] = useState('');
  const [holdStart, setHoldStart] = useState('19:00');
  const [holdEnd, setHoldEnd] = useState('22:00');
  const [holdReason, setHoldReason] = useState('');
  const [holdError, setHoldError] = useState<string | null>(null);

  const submitHold = async () => {
    if (!venue?.id || !holdDate || !holdReason.trim()) {
      setHoldError('Date and reason are required.');
      return;
    }
    try {
      const startsAt = new Date(`${holdDate}T${holdStart}:00`).toISOString();
      const endsAt = new Date(`${holdDate}T${holdEnd}:00`).toISOString();
      await createHold({ venueId: venue.id, startsAt, endsAt, reason: holdReason.trim() });
      setHoldReason('');
      setHoldError(null);
    } catch (err) {
      setHoldError(errorMessage(err, 'Failed to create hold.'));
    }
  };

  const { selected: listDateRange, setSelected: setListDateRange, presets: listPresets } = useDateRange('today');

  const sorted = useMemo(() => {
    const { startTs, endTs } = listDateRange;
    return [...reservations]
      .filter((r) => r.reservationTime >= startTs && r.reservationTime <= endTs)
      .sort((a, b) => a.reservationTime - b.reservationTime);
  }, [reservations, listDateRange]);

  const todayStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const dateOptions = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      const label = i === 0 ? `Today · ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : i === 1 ? `Tomorrow · ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      return { value, label, dayOfWeek: d.getDay() };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayStr]);

  const selectedDateOption = dateOptions.find((o) => o.value === date) ?? dateOptions[0];
  const availableMeals = getMealsForDayOfWeek(selectedDateOption?.dayOfWeek ?? new Date().getDay());

  const createReservation = async () => {
    setError(null);
    const firstName = guestFirstName.trim();
    const lastName = guestLastName.trim();
    const fullName = [firstName, lastName].filter(Boolean).join(' ');
    if (!venue?.id || !firstName || !lastName) {
      setError('Enter first and last name.');
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
        guestName: fullName,
        guestPhone: guestPhone.trim() || undefined,
        guestEmail: guestEmail.trim() || undefined,
        guestCompany: guestCompany.trim() || undefined,
        partySize,
        reservationTime: ts,
        durationMinutes: showPrivateEventForm ? 240 : (MEAL_TIMES[selectedMeal]?.duration ?? 120),
        source,
        status: 'confirmed',
        tags: splitTags(tags),
        occasion: occasion.trim() || undefined,
        specialRequests: notes.trim() || undefined,
        notes: notes.trim() || undefined,
        isPrivateEvent: showPrivateEventForm,
        eventName: showPrivateEventForm ? eventName.trim() || undefined : undefined,
        eventStatus: showPrivateEventForm ? 'proposal' : undefined,
        eventSpace: showPrivateEventForm ? eventSpace.trim() || undefined : undefined,
        setupStyle: showPrivateEventForm ? setupStyle.trim() || undefined : undefined,
        menuNotes: showPrivateEventForm ? menuNotes.trim() || undefined : undefined,
        beverageNotes: showPrivateEventForm ? beverageNotes.trim() || undefined : undefined,
        billingNotes: showPrivateEventForm ? billingNotes.trim() || undefined : undefined,
        contractStatus: showPrivateEventForm ? 'draft' : undefined,
        beoStatus: showPrivateEventForm ? 'draft' : undefined,
        estimatedValueCents: showPrivateEventForm ? dollarsToCents(estimatedValue) : undefined,
        depositDueCents: showPrivateEventForm ? dollarsToCents(depositDue) : undefined,
      });
      setGuestFirstName('');
      setGuestLastName('');
      setGuestPhone('');
      setGuestEmail('');
      setGuestCompany('');
      setTags('');
      setOccasion('');
      setNotes('');
      setEventName('');
      setEventSpace('');
      setSetupStyle('');
      setMenuNotes('');
      setBeverageNotes('');
      setBillingNotes('');
      setEstimatedValue('');
      setDepositDue('');
      setPartySize(2);
      const todayDow = new Date().getDay();
      setSelectedMeal(todayDow === 0 || todayDow === 6 ? 'brunch' : 'dinner');
      setTime(todayDow === 0 || todayDow === 6 ? '10:00' : '18:00');
      setShowForm(false);
      setShowPrivateEventForm(false);
    } catch (e) {
      setError(errorMessage(e, 'Could not create reservation.'));
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
      setDeleteError(errorMessage(e, 'Could not delete reservation.'));
    }
  };

  const statCards = useMemo(
    () => [
      { label: 'Active', value: page?.activeCount ?? 0, a: accents[2] },
      { label: 'Upcoming', value: page?.upcomingCount ?? 0, a: accents[0] },
      { label: 'Private events', value: reservations.filter((item) => item.isPrivateEvent).length, a: accents[5] },
      { label: 'Cancelled', value: page?.cancelledCount ?? 0, a: accents[1] },
    ],
    [page, reservations],
  );

  return (
    <FlatList
      data={sorted}
      keyExtractor={(item) => item.id}
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
      removeClippedSubviews
      ListHeaderComponent={(
        <>
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
        {statCards.map((s) => (
          <Card key={s.label} style={{ flex: 1, backgroundColor: s.a.bg, borderRadius: 16 }}>
            <Card.Content style={{ gap: 2 }}>
              <Text style={{ color: s.a.fg, fontSize: 24, fontWeight: '800' }}>{s.value}</Text>
              <Text style={{ color: colors.muted }}>{s.label}</Text>
            </Card.Content>
          </Card>
        ))}
      </View>

      {/* Cover pacing */}
      {pacing && pacing.buckets.length > 0 ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }}>
              <View>
                <Text variant="titleMedium" style={{ fontWeight: '700' }}>Cover pacing — {pacing.date}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  Peak {pacing.peakCovers} covers · {pacing.totalReservations} bookings · seating capacity {pacing.seatingCapacity || '—'}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 100 }}>
              {pacing.buckets.map((b, i) => {
                const ratio = pacing.peakCovers > 0 ? b.covers / pacing.peakCovers : 0;
                const overCapacity = pacing.seatingCapacity > 0 && b.covers > pacing.seatingCapacity;
                return (
                  <View key={i} style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}>
                    <View style={{ height: `${Math.max(2, ratio * 100)}%`, backgroundColor: overCapacity ? colors.danger : colors.primary, borderRadius: 2 }} />
                  </View>
                );
              })}
            </View>
            {pacing.seatingCapacity > 0 && pacing.peakCovers > pacing.seatingCapacity ? (
              <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>
                Peak exceeds seating capacity — consider spreading bookings or pacing the kitchen.
              </Text>
            ) : null}
          </Card.Content>
        </Card>
      ) : null}

      {/* Reservation holds */}
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Holds & blocked time</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            Block off windows (staff meeting, buyout, deep clean) so the booking form refuses overlapping reservations.
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
            <TextInput label="Date" value={holdDate} onChangeText={setHoldDate} mode="outlined" dense placeholder="YYYY-MM-DD" style={{ width: 150, backgroundColor: colors.surface }} />
            <TextInput label="Start" value={holdStart} onChangeText={setHoldStart} mode="outlined" dense style={{ width: 90, backgroundColor: colors.surface }} />
            <TextInput label="End" value={holdEnd} onChangeText={setHoldEnd} mode="outlined" dense style={{ width: 90, backgroundColor: colors.surface }} />
            <TextInput label="Reason" value={holdReason} onChangeText={setHoldReason} mode="outlined" dense style={{ flex: 1, minWidth: 160, backgroundColor: colors.surface }} />
            <Button mode="contained" buttonColor={colors.primary} onPress={() => void submitHold()} accessibilityLabel="Add reservation hold">Hold</Button>
          </View>
          {holdError ? <Text style={{ color: colors.danger, fontSize: 12 }}>{holdError}</Text> : null}
          {(holds ?? []).length === 0 ? (
            <Text style={{ color: colors.muted }}>No upcoming holds.</Text>
          ) : (
            (holds ?? []).map((h) => (
              <View key={h.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.charcoal, fontWeight: '700' }}>{h.reason}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    {new Date(h.startsAt).toLocaleString()} → {new Date(h.endsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </Text>
                </View>
                <Button compact mode="text" textColor={colors.danger} onPress={() => void (venue?.id && deleteHold({ venueId: venue.id, holdId: h.id }))}>
                  Remove
                </Button>
              </View>
            ))
          )}
        </Card.Content>
      </Card>

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
            <TextInput label="Email (auto-notify)" value={wlEmail} onChangeText={setWlEmail} mode="outlined" dense autoCapitalize="none" keyboardType="email-address" style={{ flex: 1, backgroundColor: colors.surface }} />
            <Button mode="contained" buttonColor={colors.primary} onPress={() => void addWalkIn()} accessibilityLabel="Add walk-in to waitlist">Add</Button>
          </View>
          <Text style={{ color: colors.muted, fontSize: 11 }}>
            Adding an email lets us auto-notify this guest when a fitting table opens up.
          </Text>
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
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Button compact mode={showPrivateEventForm ? 'contained' : 'outlined'} buttonColor={showPrivateEventForm ? colors.primary : undefined} textColor={showPrivateEventForm ? '#fff' : colors.primary} onPress={() => {
                  setShowForm(true);
                  setShowPrivateEventForm((value) => !value);
                  setPartySize((value) => Math.max(value, 20));
                  setTags((value) => (value.includes('private_event') ? value : [value, 'private_event'].filter(Boolean).join(', ')));
                }}>
                  Private event
                </Button>
                <Button compact mode={showForm ? 'text' : 'contained'} buttonColor={showForm ? undefined : colors.primary} onPress={() => setShowForm((v) => !v)}>
                  {showForm ? 'Close' : 'Add'}
                </Button>
              </View>
            </View>
            {showForm ? (
              <>
                <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                  <TextInput label="First name" value={guestFirstName} onChangeText={setGuestFirstName} mode="outlined" style={{ flex: 1, minWidth: 140, backgroundColor: colors.surface }} />
                  <TextInput label="Last name" value={guestLastName} onChangeText={setGuestLastName} mode="outlined" style={{ flex: 1, minWidth: 140, backgroundColor: colors.surface }} />
                </View>
                <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                  <TextInput label="Phone number" value={guestPhone} onChangeText={setGuestPhone} mode="outlined" keyboardType="phone-pad" style={{ flex: 1, minWidth: 145, backgroundColor: colors.surface }} />
                  <TextInput label="Email" value={guestEmail} onChangeText={setGuestEmail} mode="outlined" keyboardType="email-address" autoCapitalize="none" style={{ flex: 1, minWidth: 145, backgroundColor: colors.surface }} />
                </View>
                {autofill?.guest ? (
                  <Card style={{ backgroundColor: accents[2].bg, borderRadius: 12 }}>
                    <Card.Content style={{ gap: 4, padding: spacing.sm }}>
                      <Text style={{ color: accents[2].fg, fontWeight: '800' }}>Returning guest — {autofill.guest.fullName}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>
                        {autofill.guest.lastVisitAt
                          ? `Last visit ${new Date(autofill.guest.lastVisitAt).toLocaleDateString()}${autofill.guest.lastPartySize ? ` · party of ${autofill.guest.lastPartySize}` : ''}`
                          : 'No prior visits logged'}
                        {autofill.guest.lifecycleStage ? ` · ${autofill.guest.lifecycleStage}` : ''}
                      </Text>
                      {autofill.guest.favoriteTable ? <Text style={{ color: colors.muted, fontSize: 12 }}>Favorite table: {autofill.guest.favoriteTable}</Text> : null}
                      {autofill.guest.preferredServer ? <Text style={{ color: colors.muted, fontSize: 12 }}>Preferred server: {autofill.guest.preferredServer}</Text> : null}
                      {autofill.guest.dietaryNotes ? <Text style={{ color: colors.danger, fontSize: 12 }}>Dietary: {autofill.guest.dietaryNotes}</Text> : null}
                      <Button compact mode="text" textColor={colors.primary} onPress={() => {
                        const [first, ...rest] = autofill.guest!.fullName.split(' ');
                        setGuestFirstName(first ?? '');
                        setGuestLastName(rest.join(' '));
                      }}>Use this name</Button>
                    </Card.Content>
                  </Card>
                ) : null}
                <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                  <TextInput label="Company (optional)" value={guestCompany} onChangeText={setGuestCompany} mode="outlined" style={{ flex: 1, minWidth: 145, backgroundColor: colors.surface }} />
                  <TextInput label="Occasion" value={occasion} onChangeText={setOccasion} mode="outlined" placeholder="Birthday, anniversary, business dinner" style={{ flex: 1, minWidth: 145, backgroundColor: colors.surface }} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ width: 64 }}>Party</Text>
                  <IconButton icon="minus" mode="outlined" size={16} onPress={() => setPartySize((p) => Math.max(1, p - 1))} />
                  <Text style={{ minWidth: 28, textAlign: 'center' }}>{partySize}</Text>
                  <IconButton icon="plus" mode="outlined" size={16} onPress={() => setPartySize((p) => Math.min(30, p + 1))} />
                </View>
                <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                  <Menu
                    visible={dateMenuOpen}
                    onDismiss={() => setDateMenuOpen(false)}
                    anchor={
                      <Button mode="outlined" onPress={() => setDateMenuOpen(true)} style={{ flex: 1, minWidth: 140 }} contentStyle={{ justifyContent: 'flex-start' }}>
                        {selectedDateOption?.label ?? date}
                      </Button>
                    }
                  >
                    {dateOptions.map((opt) => (
                      <Menu.Item
                        key={opt.value}
                        title={opt.label}
                        onPress={() => {
                          setDate(opt.value);
                          setDateMenuOpen(false);
                          const meals = getMealsForDayOfWeek(opt.dayOfWeek);
                          const stillValid = meals.some((m) => m.label.toLowerCase() === selectedMeal);
                          if (!stillValid) {
                            const fallback = opt.dayOfWeek === 0 || opt.dayOfWeek === 6 ? 'brunch' : 'dinner';
                            setSelectedMeal(fallback);
                            setTime(MEAL_TIMES[fallback].time);
                          }
                        }}
                      />
                    ))}
                  </Menu>
                  <TextInput
                    label="Time"
                    value={time}
                    onChangeText={setTime}
                    mode="outlined"
                    placeholder="HH:MM"
                    style={{ width: 90, backgroundColor: colors.surface }}
                  />
                  <Menu
                    visible={mealMenuOpen}
                    onDismiss={() => setMealMenuOpen(false)}
                    anchor={
                      <Button mode="outlined" onPress={() => setMealMenuOpen(true)} style={{ flex: 1, minWidth: 140 }} contentStyle={{ justifyContent: 'flex-start' }}>
                        {MEAL_TIMES[selectedMeal]?.label ?? selectedMeal}
                      </Button>
                    }
                  >
                    {availableMeals.map((meal) => {
                      const key = meal.label.toLowerCase();
                      return (
                        <Menu.Item
                          key={key}
                          title={`${meal.label} · ${meal.time}`}
                          onPress={() => {
                            setSelectedMeal(key);
                            setTime(meal.time);
                            setMealMenuOpen(false);
                          }}
                        />
                      );
                    })}
                  </Menu>
                </View>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  Meal sets a quick default time and course duration — edit Time directly for any other slot.
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {reservationSources.map((s) => (
                    <Chip key={s} selected={source === s} onPress={() => setSource(s)}>{s.replace('_', ' ')}</Chip>
                  ))}
                </View>
                {showPrivateEventForm ? (
                  <Card style={{ backgroundColor: accents[5].bg, borderRadius: 14 }}>
                    <Card.Content style={{ gap: spacing.sm }}>
                      <Text variant="titleSmall" style={{ color: accents[5].fg, fontWeight: '800' }}>Private event booking</Text>
                      <Text style={{ color: colors.muted }}>Capture event details needed to generate BEOs and contracts from CRM.</Text>
                      <TextInput label="Event name" value={eventName} onChangeText={setEventName} mode="outlined" style={{ backgroundColor: colors.surface }} />
                      <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                        <TextInput label="Event space / room" value={eventSpace} onChangeText={setEventSpace} mode="outlined" style={{ flex: 1, minWidth: 145, backgroundColor: colors.surface }} />
                        <TextInput label="Setup style" value={setupStyle} onChangeText={setSetupStyle} mode="outlined" placeholder="Cocktail, seated dinner, classroom" style={{ flex: 1, minWidth: 145, backgroundColor: colors.surface }} />
                      </View>
                      <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                        <TextInput label="Estimated value" value={estimatedValue} onChangeText={setEstimatedValue} mode="outlined" keyboardType="decimal-pad" style={{ flex: 1, minWidth: 145, backgroundColor: colors.surface }} />
                        <TextInput label="Deposit due" value={depositDue} onChangeText={setDepositDue} mode="outlined" keyboardType="decimal-pad" style={{ flex: 1, minWidth: 145, backgroundColor: colors.surface }} />
                      </View>
                      <TextInput label="Menu notes" value={menuNotes} onChangeText={setMenuNotes} mode="outlined" multiline style={{ backgroundColor: colors.surface }} />
                      <TextInput label="Beverage notes" value={beverageNotes} onChangeText={setBeverageNotes} mode="outlined" multiline style={{ backgroundColor: colors.surface }} />
                      <TextInput label="Billing / contract notes" value={billingNotes} onChangeText={setBillingNotes} mode="outlined" multiline style={{ backgroundColor: colors.surface }} />
                    </Card.Content>
                  </Card>
                ) : null}
                <TextInput label="Guest notes / requests" value={notes} onChangeText={setNotes} mode="outlined" multiline style={{ backgroundColor: colors.surface }} />
                {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
                <Button mode="contained" buttonColor={colors.primary} onPress={() => void createReservation()} accessibilityLabel="Create reservation">Create reservation</Button>
              </>
            ) : null}
          </Card.Content>
        </Card>
      ) : null}

      {/* Reservation list */}
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }}>
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>Bookings</Text>
            <DateRangeBar selected={listDateRange} presets={listPresets} onSelect={setListDateRange} />
          </View>
          {deleteError ? <Text style={{ color: colors.danger }}>{deleteError}</Text> : null}
          {page === undefined ? (
            <Text style={{ color: colors.muted }}>Loading…</Text>
          ) : sorted.length === 0 ? (
            <Text style={{ color: colors.muted }}>No reservations for {listDateRange.shortLabel.toLowerCase()}.</Text>
          ) : null}
        </Card.Content>
      </Card>
        </>
      )}
        renderItem={({ item: res }) => {
          const sc = statusColor[res.status] ?? { bg: colors.cream, fg: colors.muted };
          const seated = res.status === 'seated';
          const cancelled = res.status === 'cancelled' || res.status === 'no_show' || res.status === 'completed';
          return (
            <View style={{ paddingVertical: 10, paddingHorizontal: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 6, backgroundColor: colors.surface }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View>
                  <Text style={{ fontWeight: '800' }}>{formatWeekdayDate(res.reservationTime)}</Text>
                  <Text style={{ color: colors.muted, fontSize: 13 }}>{formatTime(res.reservationTime)}</Text>
                </View>
                <Chip compact style={{ backgroundColor: sc.bg }} textStyle={{ color: sc.fg }}>{res.status.replace('_', ' ')}</Chip>
              </View>
              <Text>{res.guestName} · party of {res.partySize}</Text>
              <Text style={{ color: colors.muted }}>{res.source.replace('_', ' ')}</Text>
              {res.guestCompany ? <Text style={{ color: colors.muted }}>{res.guestCompany}</Text> : null}
              {res.occasion ? <Chip compact style={{ alignSelf: 'flex-start' }}>{res.occasion}</Chip> : null}
              {res.isPrivateEvent ? (
                <Card style={{ backgroundColor: accents[5].bg, borderRadius: 12 }}>
                  <Card.Content style={{ gap: 4 }}>
                    <Text style={{ color: accents[5].fg, fontWeight: '800' }}>{res.eventName || 'Private event'}</Text>
                    <Text style={{ color: colors.muted }}>{[res.eventSpace, res.setupStyle, res.eventStatus?.replace('_', ' ')].filter(Boolean).join(' ? ') || 'Event details pending'}</Text>
                    {res.estimatedValueCents ? <Text style={{ color: colors.muted }}>Estimated value ${(res.estimatedValueCents / 100).toLocaleString()}</Text> : null}
                  </Card.Content>
                </Card>
              ) : null}

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
                    <Text style={{ color: colors.danger }}>No open tables. Build a floor plan first.</Text>
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
        }}
    />
  );
}
