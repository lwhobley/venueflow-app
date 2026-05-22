import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Chip, Text, TextInput } from 'react-native-paper';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { accents, colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';

type Shift = {
  _id: Id<'scheduleShifts'>;
  dayLabel: string;
  startTime: string;
  endTime: string;
  jobTitle: string;
  station: string;
  status: 'scheduled' | 'open' | 'covered';
  mine: boolean;
  conflict: boolean;
};

type Blackout = { _id: Id<'blackoutDates'>; startDate: string; endDate: string; reason: string };

export function MyShifts() {
  const venue = useAuthStore((state: AuthState) => state.venue);
  const data = useQuery(api.scheduling.getMySchedule);
  const blackoutData = useQuery(api.scheduling.listBlackouts, venue?.id ? { venueId: venue.id } : 'skip');
  const claimOpenShift = useMutation(api.scheduling.claimOpenShift);
  const requestDropShift = useMutation(api.scheduling.requestDropShift);
  const createRequest = useMutation(api.app.createStaffRequest);

  const [offStart, setOffStart] = useState('');
  const [offEnd, setOffEnd] = useState('');
  const [offReason, setOffReason] = useState('');
  const [offError, setOffError] = useState<string | null>(null);
  const [offOk, setOffOk] = useState(false);

  const mine = useMemo(() => (data?.mine ?? []) as Shift[], [data]);
  const open = useMemo(() => (data?.open ?? []) as Shift[], [data]);
  const blackouts = useMemo(() => (blackoutData ?? []) as Blackout[], [blackoutData]);

  const submitTimeOff = async () => {
    setOffError(null);
    setOffOk(false);
    if (!venue?.id || !offStart.trim()) {
      setOffError('Enter at least a start date (YYYY-MM-DD).');
      return;
    }
    try {
      await createRequest({
        venueId: venue.id,
        kind: 'time_off',
        title: `Time off ${offStart.trim()}${offEnd.trim() ? ` – ${offEnd.trim()}` : ''}`,
        details: offReason.trim() || 'Requesting time off.',
        requestedRangeStart: offStart.trim(),
        requestedRangeEnd: offEnd.trim() || offStart.trim(),
      });
      setOffStart('');
      setOffEnd('');
      setOffReason('');
      setOffOk(true);
    } catch (e) {
      setOffError(e instanceof Error ? e.message : 'Could not submit request.');
    }
  };

  if (data === undefined) return <Text style={{ color: colors.muted }}>Loading your shifts…</Text>;

  return (
    <View style={{ gap: spacing.md }}>
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>My shifts</Text>
          {mine.length === 0 ? (
            <Text style={{ color: colors.muted }}>You have no scheduled shifts yet.</Text>
          ) : (
            mine.map((s) => (
              <View key={s._id} style={{ padding: 12, borderRadius: 12, backgroundColor: s.conflict ? '#FDE7E9' : colors.cream, borderWidth: s.conflict ? 1.5 : 0, borderColor: colors.danger, gap: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontWeight: '700' }}>{s.dayLabel} · {s.startTime} – {s.endTime}</Text>
                  {s.conflict ? <Text style={{ color: colors.danger, fontWeight: '700' }}>⚠ Outside availability</Text> : null}
                </View>
                <Text>{s.jobTitle} · {s.station}</Text>
                <Button compact mode="outlined" textColor={colors.danger} onPress={() => void requestDropShift({ shiftId: s._id })}>
                  Request to drop
                </Button>
              </View>
            ))
          )}
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Open shifts you can pick up</Text>
          {open.length === 0 ? (
            <Text style={{ color: colors.muted }}>No open shifts right now.</Text>
          ) : (
            open.map((s) => (
              <View key={s._id} style={{ padding: 12, borderRadius: 12, backgroundColor: accents[4].bg, gap: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontWeight: '700' }}>{s.dayLabel} · {s.startTime} – {s.endTime}</Text>
                  {s.conflict ? <Chip compact style={{ backgroundColor: '#FDE7E9' }} textStyle={{ color: colors.danger }}>Outside your availability</Chip> : null}
                </View>
                <Text>{s.jobTitle} · {s.station}</Text>
                <Button compact mode="contained" buttonColor={colors.primary} onPress={() => void claimOpenShift({ shiftId: s._id })}>
                  Pick up shift
                </Button>
              </View>
            ))
          )}
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Request time off</Text>
          {blackouts.length > 0 ? (
            <View style={{ gap: 4 }}>
              <Text style={{ color: colors.muted }}>Blackout dates (can't request off):</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {blackouts.map((b) => (
                  <Chip key={b._id} compact style={{ backgroundColor: '#FDE7E9' }} textStyle={{ color: colors.danger }}>
                    {b.startDate}{b.endDate !== b.startDate ? `–${b.endDate}` : ''}
                  </Chip>
                ))}
              </View>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TextInput label="From (YYYY-MM-DD)" value={offStart} onChangeText={setOffStart} mode="outlined" autoCapitalize="none" style={{ flex: 1, backgroundColor: colors.surface }} />
            <TextInput label="To (optional)" value={offEnd} onChangeText={setOffEnd} mode="outlined" autoCapitalize="none" style={{ flex: 1, backgroundColor: colors.surface }} />
          </View>
          <TextInput label="Reason (optional)" value={offReason} onChangeText={setOffReason} mode="outlined" style={{ backgroundColor: colors.surface }} />
          {offError ? <Text style={{ color: colors.danger }}>{offError}</Text> : null}
          {offOk ? <Text style={{ color: accents[2].fg }}>Request submitted ✓</Text> : null}
          <Button mode="contained" buttonColor={colors.primary} onPress={() => void submitTimeOff()}>
            Submit time-off request
          </Button>
        </Card.Content>
      </Card>
    </View>
  );
}
