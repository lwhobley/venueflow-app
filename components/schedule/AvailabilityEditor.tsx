import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Switch, Text, TextInput } from 'react-native-paper';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { accents, colors, spacing } from '../../lib/theme';
import { useAuthenticatedSession } from '../../lib/auth-readiness';

const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

type DayState = { available: boolean; start: string; end: string };

const defaultDay = (): DayState => ({ available: true, start: '09:00', end: '17:00' });

export function AvailabilityEditor() {
  const { isReady } = useAuthenticatedSession();
  const saved = useQuery(api.scheduling.getMyAvailability, isReady ? {} : 'skip');
  const setAvailability = useMutation(api.scheduling.setMyAvailability);
  const [days, setDays] = useState<DayState[]>(dayLabels.map(defaultDay));
  const [savedNote, setSavedNote] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!saved) return;
    const next = dayLabels.map(defaultDay);
    for (const row of saved) {
      next[row.dayIndex] = {
        available: row.available,
        start: fmt(row.startMinutes),
        end: fmt(row.endMinutes),
      };
    }
    setDays(next);
  }, [saved]);

  const update = (i: number, patch: Partial<DayState>) =>
    setDays((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));

  const onSave = async () => {
    setSaving(true);
    setError(null);
    const rows = days.map((d, dayIndex) => {
      const s = parseTime(d.start) ?? 540;
      const e = parseTime(d.end) ?? 1020;
      return { dayIndex, startMinutes: s, endMinutes: Math.max(e, s + 30), available: d.available };
    });
    try {
      await setAvailability({ rows });
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
      <Card style={{ backgroundColor: accents[2].bg, borderRadius: 16 }}>
        <Card.Content style={{ gap: 4 }}>
          <Text variant="titleMedium" style={{ color: accents[2].fg, fontWeight: '700' }}>Your weekly availability</Text>
          <Text style={{ color: colors.charcoal }}>
            Set the hours you can work each day. Managers see a red conflict warning if they schedule you outside these windows.
          </Text>
        </Card.Content>
      </Card>

      {days.map((d, i) => (
        <Card key={dayLabels[i]} style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="titleMedium" style={{ fontWeight: '700' }}>{dayLabels[i]}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: d.available ? accents[2].fg : colors.muted }}>{d.available ? 'Available' : 'Off'}</Text>
                <Switch value={d.available} onValueChange={(v) => update(i, { available: v })} color={colors.primary} />
              </View>
            </View>
            {d.available ? (
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TextInput label="From (HH:MM)" value={d.start} onChangeText={(t) => update(i, { start: t })} mode="outlined" style={{ flex: 1, backgroundColor: colors.surface }} />
                <TextInput label="To (HH:MM)" value={d.end} onChangeText={(t) => update(i, { end: t })} mode="outlined" style={{ flex: 1, backgroundColor: colors.surface }} />
              </View>
            ) : null}
          </Card.Content>
        </Card>
      ))}

      <Button mode="contained" buttonColor={colors.primary} loading={saving} disabled={saving} onPress={() => void onSave()}>
        Save availability
      </Button>
      {error ? <Text style={{ color: colors.danger, textAlign: 'center' }}>{error}</Text> : null}
      {savedNote ? <Text style={{ color: accents[2].fg, textAlign: 'center' }}>Saved ✓</Text> : null}
    </View>
  );
}
