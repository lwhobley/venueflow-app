import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, Chip, SegmentedButtons, Switch, Text, TextInput } from 'react-native-paper';
import { useMutation, useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import { colors, spacing } from '../../lib/theme';
import { useAuthenticatedSession } from '../../lib/auth-readiness';

const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type DayRow = { dayIndex: number; startMinutes: number; endMinutes: number; available: boolean };
type WeekData = { weekStart: string; locked: boolean; days: DayRow[] };
type PayPeriod = { anchor: string; lengthDays: number; unlocked: boolean };
type AvailabilityResponse = { payPeriod: PayPeriod; weeks: WeekData[] };
type DayState = { available: boolean; start: string; end: string };

const defaultDay = (): DayState => ({ available: true, start: '09:00', end: '17:00' });

function parseTime(value: string): number | null {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
function fmt(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}
function isoToUtc(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function dayDate(weekStart: string, offset: number): Date {
  const base = isoToUtc(weekStart);
  return new Date(base.getTime() + offset * 24 * 60 * 60 * 1000);
}
function weekLabel(weekStart: string): string {
  return `Week of ${isoToUtc(weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
}

export function AvailabilityEditor() {
  const { isReady, canManage } = useAuthenticatedSession();
  const saved = useQuery(api.scheduling.getMyAvailability, isReady ? {} : 'skip') as AvailabilityResponse | undefined;
  const setAvailability = useMutation(api.scheduling.setMyAvailability);

  const weeks = useMemo(() => saved?.weeks ?? [], [saved]);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [days, setDays] = useState<DayState[]>(dayLabels.map(defaultDay));
  const [savedNote, setSavedNote] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default to the first editable (unlocked) week, else the first week.
  useEffect(() => {
    if (selectedWeek && weeks.some((w) => w.weekStart === selectedWeek)) return;
    const firstEditable = weeks.find((w) => !w.locked) ?? weeks[0];
    if (firstEditable) setSelectedWeek(firstEditable.weekStart);
  }, [weeks, selectedWeek]);

  const currentWeek = weeks.find((w) => w.weekStart === selectedWeek) ?? null;

  // Seed the day editor from the selected week's saved rows.
  useEffect(() => {
    if (!currentWeek) return;
    const next = dayLabels.map(defaultDay);
    for (const row of currentWeek.days) {
      next[row.dayIndex] = { available: row.available, start: fmt(row.startMinutes), end: fmt(row.endMinutes) };
    }
    setDays(next);
    setError(null);
    setSavedNote(false);
  }, [currentWeek]);

  const update = (i: number, patch: Partial<DayState>) =>
    setDays((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));

  const locked = currentWeek?.locked ?? true;

  const onSave = async () => {
    if (!selectedWeek || locked) return;
    setSaving(true);
    setError(null);
    const rows = days.map((d, dayIndex) => {
      const s = parseTime(d.start) ?? 540;
      const e = parseTime(d.end) ?? 1020;
      return { dayIndex, startMinutes: s, endMinutes: Math.max(e, s + 30), available: d.available };
    });
    try {
      await setAvailability({ weekStart: selectedWeek, rows });
      setSavedNote(true);
      setTimeout(() => setSavedNote(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save availability.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ gap: spacing.md }}>
      {canManage ? <AvailabilityManagerSettings /> : null}

      <Card style={{ backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16 }}>
        <Card.Content style={{ gap: 4 }}>
          <Text variant="titleMedium" style={{ color: colors.charcoal, fontWeight: '700' }}>Set availability ahead</Text>
          <Text style={{ color: colors.charcoal }}>
            Set the hours you can work for each upcoming week. A week locks once its pay period starts — set it in advance. Ask a manager to unlock if you need a change.
          </Text>
        </Card.Content>
      </Card>

      {saved === undefined ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}><Card.Content><Text style={{ color: colors.muted }}>Loading availability…</Text></Card.Content></Card>
      ) : weeks.length === 0 ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}><Card.Content><Text style={{ color: colors.muted }}>Availability isn't available for this account yet.</Text></Card.Content></Card>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: 2 }}>
            {weeks.map((w) => (
              <Chip
                key={w.weekStart}
                selected={w.weekStart === selectedWeek}
                onPress={() => setSelectedWeek(w.weekStart)}
                icon={w.locked ? 'lock' : 'pencil'}
                style={{ backgroundColor: w.weekStart === selectedWeek ? colors.surfaceSoft : colors.surface }}
                textStyle={{ color: colors.charcoal }}
              >
                {weekLabel(w.weekStart)}
              </Chip>
            ))}
          </ScrollView>

          {locked ? (
            <Card style={{ backgroundColor: colors.surfaceSoft, borderColor: colors.border, borderWidth: 1, borderRadius: 16 }}>
              <Card.Content style={{ gap: 4 }}>
                <Text style={{ color: colors.charcoal, fontWeight: '700' }}>This week is locked</Text>
                <Text style={{ color: colors.charcoal }}>Its pay period has started. Ask a manager to unlock availability to make changes.</Text>
              </Card.Content>
            </Card>
          ) : null}

          {days.map((d, i) => (
            <Card key={dayLabels[i]} style={{ backgroundColor: colors.surface, borderRadius: 16, opacity: locked ? 0.6 : 1 }}>
              <Card.Content style={{ gap: spacing.sm }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                    <Text variant="titleMedium" style={{ fontWeight: '700' }}>{dayLabels[i]}</Text>
                    {selectedWeek ? (
                      <Text style={{ color: colors.muted, fontSize: 13 }}>
                        {dayDate(selectedWeek, i).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                      </Text>
                    ) : null}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ color: colors.charcoal }}>{d.available ? 'Available' : 'Off'}</Text>
                    <Switch value={d.available} onValueChange={(v) => update(i, { available: v })} color={colors.primary} disabled={locked} />
                  </View>
                </View>
                {d.available ? (
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <TextInput label="From (HH:MM)" value={d.start} onChangeText={(t) => update(i, { start: t })} mode="outlined" disabled={locked} style={{ flex: 1, backgroundColor: colors.surface }} />
                    <TextInput label="To (HH:MM)" value={d.end} onChangeText={(t) => update(i, { end: t })} mode="outlined" disabled={locked} style={{ flex: 1, backgroundColor: colors.surface }} />
                  </View>
                ) : null}
              </Card.Content>
            </Card>
          ))}

          {!locked ? (
            <Button mode="contained" buttonColor={colors.primary} loading={saving} disabled={saving} onPress={() => void onSave()}>
              Save availability
            </Button>
          ) : null}
          {error ? <Text style={{ color: colors.danger, textAlign: 'center' }}>{error}</Text> : null}
          {savedNote ? <Text style={{ color: colors.charcoal, textAlign: 'center' }}>Saved ✓</Text> : null}
        </>
      )}
    </View>
  );
}

type SettingsResponse = { anchor: string; lengthDays: number; availabilityUnlocked: boolean };

function AvailabilityManagerSettings() {
  const { isReady } = useAuthenticatedSession();
  const settings = useQuery(api.scheduling.getAvailabilitySettings, isReady ? {} : 'skip') as SettingsResponse | undefined;
  const updateSettings = useMutation(api.scheduling.updateAvailabilitySettings);

  const [weeks, setWeeks] = useState('2');
  const [anchor, setAnchor] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setWeeks(String(Math.min(4, Math.max(1, Math.round(settings.lengthDays / 7)))));
    setAnchor(settings.anchor);
  }, [settings]);

  const unlocked = settings?.availabilityUnlocked ?? false;

  const savePeriod = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor.trim())) {
      setError('Start date must be YYYY-MM-DD.');
      setBusy(false);
      return;
    }
    try {
      await updateSettings({ lengthDays: Number(weeks) * 7, anchor: anchor.trim() });
      setNote('Pay period saved ✓');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save settings.');
    } finally {
      setBusy(false);
    }
  };

  const toggleUnlock = async (value: boolean) => {
    setError(null);
    setNote(null);
    try {
      await updateSettings({ availabilityUnlocked: value });
      setNote(value ? 'Availability unlocked for the team.' : 'Availability locked.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update.');
    }
  };

  return (
    <Card style={{ backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16 }}>
      <Card.Content style={{ gap: spacing.sm }}>
        <Text variant="titleMedium" style={{ color: colors.charcoal, fontWeight: '800' }}>Manager: availability & pay periods</Text>
        <Text style={{ color: colors.charcoal }}>
          Set your pay period. Staff availability locks once a period starts. Unlock to let everyone edit locked weeks.
        </Text>
        <Text style={{ color: colors.charcoal, fontWeight: '600' }}>Pay period length</Text>
        <SegmentedButtons
          value={weeks}
          onValueChange={setWeeks}
          buttons={[
            { value: '1', label: '1 wk' },
            { value: '2', label: '2 wks' },
            { value: '3', label: '3 wks' },
            { value: '4', label: '4 wks' },
          ]}
        />
        <TextInput label="Start date" placeholder="YYYY-MM-DD" value={anchor} onChangeText={setAnchor} autoCapitalize="none" mode="outlined" style={{ backgroundColor: colors.surface }} />
        <Button mode="contained" buttonColor={colors.primary} loading={busy} disabled={busy} onPress={() => void savePeriod()}>
          Save pay period
        </Button>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: 4 }}>
          <Text style={{ color: colors.charcoal, flex: 1 }}>Unlock availability for the whole team</Text>
          <Switch value={unlocked} onValueChange={(v) => void toggleUnlock(v)} color={colors.primary} />
        </View>
        {note ? <Text style={{ color: colors.charcoal }}>{note}</Text> : null}
        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      </Card.Content>
    </Card>
  );
}
