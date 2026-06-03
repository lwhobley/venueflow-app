import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, Chip, SegmentedButtons, Switch, Text, TextInput } from 'react-native-paper';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { accents, colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { useAuthenticatedSession } from '../../lib/auth-readiness';
import { canManageVenue } from '../../lib/permissions';
import { PremiumFeatureGate } from '../../components/PremiumFeatureGate';

type LifecycleStage = 'lead' | 'regular' | 'vip' | 'lapsed';
type Segment = 'all' | LifecycleStage | 'upcoming' | 'needs_follow_up';

type LeadImportRow = {
  fullName: string;
  phone?: string;
  email?: string;
  source?: string;
  company?: string;
  tags?: string[];
  notes?: string;
  marketingOptIn?: boolean;
};

type GuestRow = {
  _id: Id<'guests'>;
  fullName: string;
  phone: string | null;
  email: string | null;
  lifecycleStage: LifecycleStage;
  source: string | null;
  birthday: string | null;
  company: string | null;
  marketingOptIn: boolean;
  favoriteTable: string | null;
  preferredServer: string | null;
  dietaryNotes: string | null;
  tags: string[];
  notes: string | null;
  reservationCount: number;
  visitCount: number;
  lastVisitAt: number | null;
  upcomingReservationAt: number | null;
  totalSpendCents: number;
  averageSpendCents: number;
  daysSinceLastVisit: number | null;
};

type ReservationEvent = {
  _id: Id<'reservations'>;
  partySize: number;
  reservationTime: number;
  status: string;
  tags: string[];
  notes: string | null;
  isPrivateEvent: boolean;
  eventName: string | null;
  eventStatus: string | null;
  eventSpace: string | null;
  setupStyle: string | null;
  menuNotes: string | null;
  beverageNotes: string | null;
  billingNotes: string | null;
  estimatedValueCents: number | null;
  depositDueCents: number | null;
};

type CheckEvent = {
  _id: Id<'posChecks'>;
  provider: string;
  openedAt: number;
  closedAt: number | null;
  totalCents: number;
  tipCents: number;
  status: string;
  revenueCenter: string | null;
  tenderType: string | null;
  guestCount: number | null;
  menuItems: Array<{ name: string; category: string | null; quantity: number; priceCents: number }>;
};

type GuestProfile = { guest: GuestRow; reservations: ReservationEvent[]; checks: CheckEvent[] };

const segmentOptions: Array<{ value: Segment; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'vip', label: 'VIP' },
  { value: 'regular', label: 'Regulars' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'needs_follow_up', label: 'Follow-up' },
];

const lifecycleOptions: Array<{ value: LifecycleStage; label: string }> = [
  { value: 'lead', label: 'Lead' },
  { value: 'regular', label: 'Regular' },
  { value: 'vip', label: 'VIP' },
  { value: 'lapsed', label: 'Lapsed' },
];

function money(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dateText(value: number | null) {
  return value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'None';
}

function dateTimeText(value: number) {
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fullDateTimeText(value: number) {
  return new Date(value).toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function scoreGuest(guest: GuestRow) {
  const spendScore = Math.min(45, Math.floor(guest.totalSpendCents / 5000));
  const visitScore = Math.min(35, guest.visitCount * 7);
  const futureScore = guest.upcomingReservationAt ? 10 : 0;
  const profileScore = (guest.email ? 4 : 0) + (guest.phone ? 3 : 0) + (guest.tags.length ? 3 : 0);
  return Math.min(100, spendScore + visitScore + futureScore + profileScore);
}

function splitTags(value: string) {
  return value.split(',').map((tag) => tag.trim()).filter(Boolean);
}

function latestEventReservation(profile: GuestProfile | null | undefined) {
  return [...(profile?.reservations ?? [])]
    .filter((reservation) => reservation.isPrivateEvent || reservation.tags.includes('private_event'))
    .sort((a, b) => b.reservationTime - a.reservationTime)[0] ?? profile?.reservations?.[0] ?? null;
}

function generateBeo(guest: GuestRow, profile: GuestProfile | null | undefined) {
  const event = latestEventReservation(profile);
  const topItems = new Map<string, number>();
  for (const check of profile?.checks ?? []) {
    for (const item of check.menuItems) topItems.set(item.name, (topItems.get(item.name) ?? 0) + item.quantity);
  }
  const favorites = Array.from(topItems.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, quantity]) => `${name} (${quantity})`).join(', ') || 'Review with client';
  return [
    'BANQUET EVENT ORDER',
    `Client: ${guest.fullName}`,
    `Company / Group: ${guest.company ?? event?.eventName ?? 'TBD'}`,
    `Contact: ${guest.phone ?? 'No phone'} · ${guest.email ?? 'No email'}`,
    `Event: ${event?.eventName ?? 'Private event'}`,
    `Date / Time: ${event ? fullDateTimeText(event.reservationTime) : 'TBD'}`,
    `Guest Count: ${event?.partySize ?? 'TBD'}`,
    `Room / Space: ${event?.eventSpace ?? 'TBD'}`,
    `Setup: ${event?.setupStyle ?? 'TBD'}`,
    `Menu: ${event?.menuNotes ?? favorites}`,
    `Beverage: ${event?.beverageNotes ?? 'TBD'}`,
    `Dietary / Allergies: ${guest.dietaryNotes ?? 'None captured'}`,
    `Service Notes: ${event?.notes ?? guest.notes ?? 'TBD'}`,
    `Billing Notes: ${event?.billingNotes ?? 'TBD'}`,
  ].join('\n');
}

function generateContract(guest: GuestRow, profile: GuestProfile | null | undefined) {
  const event = latestEventReservation(profile);
  return [
    'PRIVATE EVENT CONTRACT DRAFT',
    `Client: ${guest.fullName}`,
    `Contact: ${guest.phone ?? 'No phone'} · ${guest.email ?? 'No email'}`,
    `Event: ${event?.eventName ?? 'Private event'} at ${event?.eventSpace ?? 'TBD'}`,
    `Date / Time: ${event ? fullDateTimeText(event.reservationTime) : 'TBD'}`,
    `Guest Count: ${event?.partySize ?? 'TBD'}`,
    `Estimated Event Value: ${event?.estimatedValueCents ? money(event.estimatedValueCents) : 'TBD'}`,
    `Deposit Due: ${event?.depositDueCents ? money(event.depositDueCents) : 'TBD'}`,
    'Included Services: Food, beverage, staffing, and room setup as described in the attached BEO.',
    'Payment Terms: Deposit due at signing. Final balance due per venue policy.',
    'Cancellation Terms: Subject to venue cancellation policy and signed agreement.',
    `Special Terms: ${event?.billingNotes ?? guest.notes ?? 'TBD'}`,
  ].join('\n');
}

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseLeadLines(value: string, defaultSource: string): LeadImportRow[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index) => !(index === 0 && /name/i.test(splitCsvLine(line)[0] ?? '')))
    .map((line) => {
      const [fullName, second, third, fourth, fifth, sixth, seventh] = splitCsvLine(line);
      const secondIsEmail = second?.includes('@');
      const thirdLooksLikePhone = Boolean(third?.match(/\d/));
      const email = secondIsEmail ? second : undefined;
      const phone = secondIsEmail ? (thirdLooksLikePhone ? third : undefined) : second || undefined;
      const source = secondIsEmail ? (thirdLooksLikePhone ? fourth : third) : third;
      const company = secondIsEmail ? (thirdLooksLikePhone ? fifth : fourth) : fourth;
      const tagsText = secondIsEmail ? (thirdLooksLikePhone ? sixth : fifth) : fifth;
      const notes = secondIsEmail ? (thirdLooksLikePhone ? seventh : sixth) : sixth;
      return {
        fullName,
        email,
        phone: phone || undefined,
        source: source || defaultSource || undefined,
        company: company || undefined,
        tags: tagsText ? splitTags(tagsText.replaceAll('|', ',')) : undefined,
        notes: notes || undefined,
        marketingOptIn: true,
      };
    })
    .filter((row) => row.fullName);
}

export default function GuestsScreen() {
  return (
    <PremiumFeatureGate feature="CRM">
      <GuestsScreenInner />
    </PremiumFeatureGate>
  );
}

function GuestsScreenInner() {
  const venue = useAuthStore((state: AuthState) => state.venue);
  const { isReady, user } = useAuthenticatedSession();
  const me = useQuery(api.app.getMe, isReady ? {} : 'skip');
  const canManage = canManageVenue(me?.profile.role ?? user?.role, me?.profile.allAccess ?? user?.all_access);
  const guests = useQuery(api.guests.listGuests, isReady && canManage && venue?.id ? { venueId: venue.id } : 'skip') as GuestRow[] | undefined;
  const upsertGuest = useMutation(api.guests.upsertGuest);
  const ingestLeads = useMutation(api.guests.ingestLeads);
  const removeGuest = useMutation(api.guests.removeGuest);

  const [query, setQuery] = useState('');
  const [segment, setSegment] = useState<Segment>('all');
  const [showForm, setShowForm] = useState(false);
  const [showLeadImport, setShowLeadImport] = useState(false);
  const [selectedGuestId, setSelectedGuestId] = useState<Id<'guests'> | null>(null);
  const [editingGuestId, setEditingGuestId] = useState<Id<'guests'> | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [lifecycleStage, setLifecycleStage] = useState<LifecycleStage>('lead');
  const [source, setSource] = useState('');
  const [birthday, setBirthday] = useState('');
  const [company, setCompany] = useState('');
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [favoriteTable, setFavoriteTable] = useState('');
  const [preferredServer, setPreferredServer] = useState('');
  const [dietaryNotes, setDietaryNotes] = useState('');
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [leadSource, setLeadSource] = useState('Website');
  const [leadText, setLeadText] = useState('');
  const [leadBusy, setLeadBusy] = useState(false);
  const [leadMessage, setLeadMessage] = useState<string | null>(null);

  const selectedGuest = useMemo(() => guests?.find((guest) => guest._id === selectedGuestId) ?? guests?.[0] ?? null, [guests, selectedGuestId]);
  const profile = useQuery(
    api.guests.getGuestProfile,
    isReady && canManage && venue?.id && selectedGuest ? { venueId: venue.id, guestId: selectedGuest._id } : 'skip',
  ) as GuestProfile | null | undefined;

  useEffect(() => {
    if (!selectedGuestId && guests?.[0]) setSelectedGuestId(guests[0]._id);
  }, [guests, selectedGuestId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = guests ?? [];
    return rows.filter((guest) => {
      const matchesSearch = !q || [guest.fullName, guest.phone ?? '', guest.email ?? '', guest.company ?? '', guest.tags.join(' ')].some((value) => value.toLowerCase().includes(q));
      const matchesSegment =
        segment === 'all' ||
        guest.lifecycleStage === segment ||
        (segment === 'upcoming' && Boolean(guest.upcomingReservationAt)) ||
        (segment === 'needs_follow_up' && !guest.upcomingReservationAt && (guest.daysSinceLastVisit == null || guest.daysSinceLastVisit >= 30));
      return matchesSearch && matchesSegment;
    });
  }, [guests, query, segment]);

  const crmStats = useMemo(() => {
    const rows = guests ?? [];
    return {
      totalGuests: rows.length,
      vipGuests: rows.filter((guest) => guest.lifecycleStage === 'vip').length,
      upcomingGuests: rows.filter((guest) => guest.upcomingReservationAt).length,
      totalSpend: rows.reduce((sum, guest) => sum + guest.totalSpendCents, 0),
      optedIn: rows.filter((guest) => guest.marketingOptIn).length,
      needsFollowUp: rows.filter((guest) => !guest.upcomingReservationAt && (guest.daysSinceLastVisit == null || guest.daysSinceLastVisit >= 30)).length,
      leads: rows.filter((guest) => guest.lifecycleStage === 'lead').length,
    };
  }, [guests]);

  const resetForm = () => {
    setEditingGuestId(null);
    setFullName('');
    setPhone('');
    setEmail('');
    setLifecycleStage('lead');
    setSource('');
    setBirthday('');
    setCompany('');
    setMarketingOptIn(false);
    setFavoriteTable('');
    setPreferredServer('');
    setDietaryNotes('');
    setTags('');
    setNotes('');
    setError(null);
  };

  const startEdit = (guest: GuestRow) => {
    setEditingGuestId(guest._id);
    setFullName(guest.fullName);
    setPhone(guest.phone ?? '');
    setEmail(guest.email ?? '');
    setLifecycleStage(guest.lifecycleStage);
    setSource(guest.source ?? '');
    setBirthday(guest.birthday ?? '');
    setCompany(guest.company ?? '');
    setMarketingOptIn(guest.marketingOptIn);
    setFavoriteTable(guest.favoriteTable ?? '');
    setPreferredServer(guest.preferredServer ?? '');
    setDietaryNotes(guest.dietaryNotes ?? '');
    setTags(guest.tags.join(', '));
    setNotes(guest.notes ?? '');
    setShowForm(true);
  };

  const saveGuest = async () => {
    if (!venue?.id || !fullName.trim()) {
      setError('Guest name is required.');
      return;
    }
    setError(null);
    try {
      const saved = await upsertGuest({
        venueId: venue.id,
        guestId: editingGuestId ?? undefined,
        fullName: fullName.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        lifecycleStage,
        source: source.trim() || undefined,
        birthday: birthday.trim() || undefined,
        company: company.trim() || undefined,
        marketingOptIn,
        favoriteTable: favoriteTable.trim() || undefined,
        preferredServer: preferredServer.trim() || undefined,
        dietaryNotes: dietaryNotes.trim() || undefined,
        tags: splitTags(tags),
        notes: notes.trim() || undefined,
      });
      setSelectedGuestId(saved._id);
      setShowForm(false);
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save guest.');
    }
  };

  const deleteGuest = async (guestId: Id<'guests'>) => {
    if (!venue?.id) return;
    setDeleteError(null);
    try {
      await removeGuest({ venueId: venue.id, guestId });
      if (selectedGuestId === guestId) setSelectedGuestId(null);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Could not delete guest.');
    }
  };

  const importLeads = async () => {
    if (!venue?.id) return;
    const leads = parseLeadLines(leadText, leadSource);
    if (leads.length === 0) {
      setLeadMessage('Paste at least one lead: name,email,phone,source,company,tags,notes.');
      return;
    }
    setLeadBusy(true);
    setLeadMessage(null);
    try {
      const result = await ingestLeads({ venueId: venue.id, leads });
      setLeadText('');
      setSegment('lead');
      setLeadMessage(`Imported ${result.created} new lead${result.created === 1 ? '' : 's'} and updated ${result.updated}. ${result.skipped ? `${result.skipped} skipped.` : ''}`);
      if (result.guestIds[0]) setSelectedGuestId(result.guestIds[0]);
    } catch (e) {
      setLeadMessage(e instanceof Error ? e.message : 'Could not import leads.');
    } finally {
      setLeadBusy(false);
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
        <Text style={{ color: colors.muted }}>Relationship history, preferences, and follow-up cues for {venue?.name ?? 'your venue'}.</Text>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {[
          { label: 'Guests', value: String(crmStats.totalGuests), accent: accents[0] },
          { label: 'Leads', value: String(crmStats.leads), accent: accents[5] },
          { label: 'VIPs', value: String(crmStats.vipGuests), accent: accents[1] },
          { label: 'Upcoming', value: String(crmStats.upcomingGuests), accent: accents[2] },
          { label: 'Revenue', value: money(crmStats.totalSpend), accent: accents[3] },
          { label: 'Opted in', value: String(crmStats.optedIn), accent: accents[4] },
          { label: 'Follow-up', value: String(crmStats.needsFollowUp), accent: accents[5] },
        ].map((metric) => (
          <Card key={metric.label} style={{ backgroundColor: metric.accent.bg, width: '31%', minWidth: 105, flexGrow: 1, borderRadius: 16 }}>
            <Card.Content>
              <Text style={{ color: metric.accent.fg, fontSize: 22, fontWeight: '800' }}>{metric.value}</Text>
              <Text style={{ color: colors.muted }}>{metric.label}</Text>
            </Card.Content>
          </Card>
        ))}
      </View>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>Guest directory</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button compact mode="outlined" textColor={colors.primary} onPress={() => setShowLeadImport((value) => !value)}>
                {showLeadImport ? 'Close leads' : 'Import leads'}
              </Button>
              <Button compact mode={showForm ? 'text' : 'contained'} buttonColor={showForm ? undefined : colors.primary} onPress={() => {
                if (showForm) resetForm();
                setShowForm((value) => !value);
              }}>
                {showForm ? 'Close' : 'Add guest'}
              </Button>
            </View>
          </View>
          <TextInput label="Search name, company, phone, email, or tags" value={query} onChangeText={setQuery} mode="outlined" style={{ backgroundColor: colors.surface }} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <SegmentedButtons
              value={segment}
              onValueChange={(value) => setSegment(value as Segment)}
              buttons={segmentOptions.map((option) => ({ value: option.value, label: option.label }))}
              style={{ minWidth: 560 }}
            />
          </ScrollView>
          {deleteError ? <Text style={{ color: colors.danger }}>{deleteError}</Text> : null}
          {showLeadImport ? (
            <Card style={{ backgroundColor: accents[5].bg, borderRadius: 14 }}>
              <Card.Content style={{ gap: spacing.sm }}>
                <Text variant="titleSmall" style={{ color: accents[5].fg, fontWeight: '800' }}>Lead intake</Text>
                <Text style={{ color: colors.muted }}>
                  Manual entry and CSV paste use name,email,phone,source,company,tags,notes. API/webhooks, web forms, Zapier/Make, and email parsers can POST to /crm/leads.
                </Text>
                <TextInput label="Default source" value={leadSource} onChangeText={setLeadSource} mode="outlined" style={{ backgroundColor: colors.surface }} />
                <TextInput
                  label="Leads"
                  value={leadText}
                  onChangeText={setLeadText}
                  mode="outlined"
                  multiline
                  numberOfLines={6}
                  placeholder={'name,email,phone,source,company,tags,notes\nJane Doe,jane@example.com,555-0101,Web form,Private Events,VIP|birthday,Asked about April party\nMarco Lee,,555-0102,Instagram,Catering,lead,Needs follow-up'}
                  style={{ backgroundColor: colors.surface, minHeight: 130 }}
                />
                {leadMessage ? <Text style={{ color: leadMessage.startsWith('Could') || leadMessage.startsWith('Paste') ? colors.danger : colors.charcoal }}>{leadMessage}</Text> : null}
                <Button mode="contained" buttonColor={colors.primary} loading={leadBusy} disabled={leadBusy} onPress={() => void importLeads()}>
                  Ingest leads
                </Button>
              </Card.Content>
            </Card>
          ) : null}
          {showForm ? (
            <View style={{ gap: spacing.sm }}>
              <Text variant="titleSmall" style={{ fontWeight: '700' }}>{editingGuestId ? 'Edit guest profile' : 'Add guest profile'}</Text>
              <TextInput label="Full name" value={fullName} onChangeText={setFullName} mode="outlined" style={{ backgroundColor: colors.surface }} />
              <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                <TextInput label="Phone" value={phone} onChangeText={setPhone} mode="outlined" keyboardType="phone-pad" style={{ flex: 1, minWidth: 150, backgroundColor: colors.surface }} />
                <TextInput label="Email" value={email} onChangeText={setEmail} mode="outlined" keyboardType="email-address" autoCapitalize="none" style={{ flex: 1, minWidth: 150, backgroundColor: colors.surface }} />
              </View>
              <SegmentedButtons
                value={lifecycleStage}
                onValueChange={(value) => setLifecycleStage(value as LifecycleStage)}
                buttons={lifecycleOptions}
              />
              <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                <TextInput label="Source" value={source} onChangeText={setSource} mode="outlined" style={{ flex: 1, minWidth: 135, backgroundColor: colors.surface }} />
                <TextInput label="Company / group" value={company} onChangeText={setCompany} mode="outlined" style={{ flex: 1, minWidth: 135, backgroundColor: colors.surface }} />
                <TextInput label="Birthday (MM-DD)" value={birthday} onChangeText={setBirthday} mode="outlined" style={{ flex: 1, minWidth: 135, backgroundColor: colors.surface }} />
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                <TextInput label="Favorite table" value={favoriteTable} onChangeText={setFavoriteTable} mode="outlined" style={{ flex: 1, minWidth: 135, backgroundColor: colors.surface }} />
                <TextInput label="Preferred server" value={preferredServer} onChangeText={setPreferredServer} mode="outlined" style={{ flex: 1, minWidth: 135, backgroundColor: colors.surface }} />
              </View>
              <TextInput label="Dietary notes / allergies" value={dietaryNotes} onChangeText={setDietaryNotes} mode="outlined" style={{ backgroundColor: colors.surface }} />
              <TextInput label="Tags (comma-separated)" value={tags} onChangeText={setTags} mode="outlined" style={{ backgroundColor: colors.surface }} />
              <TextInput label="Internal notes" value={notes} onChangeText={setNotes} mode="outlined" multiline style={{ backgroundColor: colors.surface }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
                <Text style={{ color: colors.charcoal, flex: 1 }}>Marketing opt-in</Text>
                <Switch value={marketingOptIn} onValueChange={setMarketingOptIn} color={colors.primary} />
              </View>
              {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
              <Button mode="contained" buttonColor={colors.primary} onPress={() => void saveGuest()}>{editingGuestId ? 'Update guest' : 'Save guest'}</Button>
            </View>
          ) : null}
        </Card.Content>
      </Card>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, alignItems: 'flex-start' }}>
        <View style={{ flexGrow: 1, flexBasis: 320, gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '800', color: colors.charcoal }}>Guests ({filtered.length})</Text>
          {guests === undefined ? (
            <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}><Card.Content><Text style={{ color: colors.muted }}>Loading guests…</Text></Card.Content></Card>
          ) : filtered.length === 0 ? (
            <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}><Card.Content><Text style={{ color: colors.muted }}>No guests match this segment yet.</Text></Card.Content></Card>
          ) : filtered.map((guest) => (
            <Card key={guest._id} style={{ backgroundColor: selectedGuest?._id === guest._id ? accents[2].bg : colors.surface, borderRadius: 16 }}>
              <Card.Content style={{ gap: spacing.sm }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text variant="titleMedium" style={{ fontWeight: '700' }}>{guest.fullName}</Text>
                    <Text style={{ color: colors.muted }}>{guest.company ? `${guest.company} · ` : ''}{guest.phone || guest.email || 'No contact on file'}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontWeight: '800', color: colors.primary }}>{scoreGuest(guest)}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>score</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  <Chip compact>{guest.lifecycleStage.toUpperCase()}</Chip>
                  {guest.marketingOptIn ? <Chip compact>Opted in</Chip> : null}
                  {guest.tags.slice(0, 4).map((tag) => <Chip compact key={tag}>{tag}</Chip>)}
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  <Text style={{ color: colors.muted }}>{guest.visitCount} visits</Text>
                  <Text style={{ color: colors.muted }}>{money(guest.totalSpendCents)}</Text>
                  <Text style={{ color: colors.muted }}>Last {dateText(guest.lastVisitAt)}</Text>
                  <Text style={{ color: colors.muted }}>Next {dateText(guest.upcomingReservationAt)}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                  <Button compact mode="outlined" textColor={colors.primary} onPress={() => setSelectedGuestId(guest._id)}>Open profile</Button>
                  <Button compact mode="text" textColor={colors.primary} onPress={() => startEdit(guest)}>Edit</Button>
                </View>
              </Card.Content>
            </Card>
          ))}
        </View>

        <View style={{ flexGrow: 1, flexBasis: 360, gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '800', color: colors.charcoal }}>CRM profile</Text>
          {!selectedGuest ? (
            <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}><Card.Content><Text style={{ color: colors.muted }}>Select a guest to view their relationship profile.</Text></Card.Content></Card>
          ) : (
            <GuestProfilePanel
              guest={profile?.guest ?? selectedGuest}
              profile={profile}
              onEdit={() => startEdit(profile?.guest ?? selectedGuest)}
              onDelete={() => void deleteGuest(selectedGuest._id)}
            />
          )}
        </View>
      </View>
    </ScrollView>
  );
}

function GuestProfilePanel({ guest, profile, onEdit, onDelete }: { guest: GuestRow; profile: GuestProfile | null | undefined; onEdit: () => void; onDelete: () => void }) {
  const [generatedDocument, setGeneratedDocument] = useState('');
  const timeline = useMemo(() => {
    const reservations = (profile?.reservations ?? []).map((reservation) => ({
      id: reservation._id,
      at: reservation.reservationTime,
      title: `${reservation.status} reservation`,
      body: `Party of ${reservation.partySize}${reservation.notes ? ` · ${reservation.notes}` : ''}`,
      tags: reservation.tags,
    }));
    const checks = (profile?.checks ?? []).map((check) => ({
      id: check._id,
      at: check.closedAt ?? check.openedAt,
      title: `${money(check.totalCents)} ${check.status} check`,
      body: `${check.revenueCenter ?? check.provider}${check.guestCount ? ` · ${check.guestCount} guests` : ''}${check.tenderType ? ` · ${check.tenderType}` : ''}`,
      tags: check.menuItems.slice(0, 3).map((item) => `${item.quantity}× ${item.name}`),
    }));
    return [...reservations, ...checks].sort((a, b) => b.at - a.at).slice(0, 12);
  }, [profile]);

  const topItems = useMemo(() => {
    const byName = new Map<string, { name: string; quantity: number; spendCents: number }>();
    for (const check of profile?.checks ?? []) {
      for (const item of check.menuItems) {
        const row = byName.get(item.name) ?? { name: item.name, quantity: 0, spendCents: 0 };
        row.quantity += item.quantity;
        row.spendCents += item.quantity * item.priceCents;
        byName.set(item.name, row);
      }
    }
    return Array.from(byName.values()).sort((a, b) => b.spendCents - a.spendCents).slice(0, 5);
  }, [profile]);

  return (
    <View style={{ gap: spacing.sm }}>
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Text variant="headlineSmall" style={{ fontWeight: '800', color: colors.primary }}>{guest.fullName}</Text>
              <Text style={{ color: colors.muted }}>{guest.phone || 'No phone'} · {guest.email || 'No email'}</Text>
              {guest.company ? <Text style={{ color: colors.muted }}>{guest.company}</Text> : null}
            </View>
            <Chip>{guest.lifecycleStage.toUpperCase()}</Chip>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <Metric label="Relationship score" value={String(scoreGuest(guest))} />
            <Metric label="Lifetime spend" value={money(guest.totalSpendCents)} />
            <Metric label="Avg check" value={money(guest.averageSpendCents)} />
            <Metric label="Visits" value={String(guest.visitCount)} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {guest.tags.length > 0 ? guest.tags.map((tag) => <Chip compact key={tag}>{tag}</Chip>) : <Chip compact>No tags</Chip>}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm }}>
            <Button compact mode="outlined" textColor={colors.primary} onPress={() => setGeneratedDocument(generateBeo(guest, profile))}>Generate BEO</Button>
            <Button compact mode="outlined" textColor={colors.primary} onPress={() => setGeneratedDocument(generateContract(guest, profile))}>Generate contract</Button>
            <Button compact mode="outlined" textColor={colors.primary} onPress={onEdit}>Edit profile</Button>
            <Button compact mode="text" textColor={colors.danger} onPress={onDelete}>Delete</Button>
          </View>
        </Card.Content>
      </Card>

      {generatedDocument ? (
        <Card style={{ backgroundColor: accents[5].bg, borderRadius: 16 }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleMedium" style={{ color: accents[5].fg, fontWeight: '800' }}>Generated document</Text>
            <Text style={{ color: colors.muted }}>Copy this draft into your BEO or contract template and tighten legal/payment terms before sending.</Text>
            <TextInput value={generatedDocument} onChangeText={setGeneratedDocument} mode="outlined" multiline numberOfLines={12} style={{ backgroundColor: colors.surface, minHeight: 220 }} />
            <Button compact mode="text" textColor={colors.primary} onPress={() => setGeneratedDocument('')}>Clear draft</Button>
          </Card.Content>
        </Card>
      ) : null}

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Preferences</Text>
          <Preference label="Favorite table" value={guest.favoriteTable} />
          <Preference label="Preferred server" value={guest.preferredServer} />
          <Preference label="Birthday" value={guest.birthday} />
          <Preference label="Source" value={guest.source} />
          <Preference label="Dietary notes" value={guest.dietaryNotes} />
          <Preference label="Marketing" value={guest.marketingOptIn ? 'Opted in' : 'Not opted in'} />
          {guest.notes ? <Text style={{ color: colors.charcoal }}>{guest.notes}</Text> : null}
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Guest intelligence</Text>
          <Text style={{ color: colors.muted }}>Last visit: {dateText(guest.lastVisitAt)} · Next reservation: {dateText(guest.upcomingReservationAt)}</Text>
          {guest.daysSinceLastVisit == null ? (
            <Text style={{ color: colors.muted }}>New guest — capture preferences after their first visit.</Text>
          ) : guest.daysSinceLastVisit >= 30 && !guest.upcomingReservationAt ? (
            <Text style={{ color: colors.danger }}>No visit in {guest.daysSinceLastVisit} days. Good follow-up candidate.</Text>
          ) : (
            <Text style={{ color: colors.muted }}>Engaged guest. Keep preferences current before the next service.</Text>
          )}
          {topItems.length > 0 ? (
            <View style={{ gap: 4 }}>
              <Text style={{ fontWeight: '700' }}>Favorite items</Text>
              {topItems.map((item) => (
                <Text key={item.name} style={{ color: colors.muted }}>{item.name} · {item.quantity} ordered · {money(item.spendCents)}</Text>
              ))}
            </View>
          ) : null}
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Timeline</Text>
          {profile === undefined ? (
            <Text style={{ color: colors.muted }}>Loading relationship history…</Text>
          ) : timeline.length === 0 ? (
            <Text style={{ color: colors.muted }}>No reservations or POS checks linked yet.</Text>
          ) : timeline.map((item) => (
            <View key={String(item.id)} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: 4 }}>
              <Text style={{ fontWeight: '700' }}>{item.title}</Text>
              <Text style={{ color: colors.muted }}>{dateTimeText(item.at)} · {item.body}</Text>
              {item.tags.length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                  {item.tags.map((tag) => <Chip compact key={tag}>{tag}</Chip>)}
                </View>
              ) : null}
            </View>
          ))}
        </Card.Content>
      </Card>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ minWidth: 135, flexGrow: 1, padding: spacing.sm, borderRadius: 12, backgroundColor: accents[0].bg }}>
      <Text style={{ color: accents[0].fg, fontSize: 18, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: colors.muted, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

function Preference({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
      <Text style={{ color: colors.muted, flex: 1 }}>{label}</Text>
      <Text style={{ color: colors.charcoal, fontWeight: value ? '700' : '400', flex: 1, textAlign: 'right' }}>{value || 'Not set'}</Text>
    </View>
  );
}
