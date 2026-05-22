import { useMemo } from 'react';
import { View } from 'react-native';
import { Button, Card, Chip, Text } from 'react-native-paper';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { accents, colors, spacing } from '../../lib/theme';

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

export function MyShifts() {
  const data = useQuery(api.scheduling.getMySchedule);
  const claimOpenShift = useMutation(api.scheduling.claimOpenShift);
  const requestDropShift = useMutation(api.scheduling.requestDropShift);

  const mine = useMemo(() => (data?.mine ?? []) as Shift[], [data]);
  const open = useMemo(() => (data?.open ?? []) as Shift[], [data]);

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
    </View>
  );
}
