import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { CommandButton, CommandSurface, CommandText, StatusPill } from './FutureUI';
import type { DesignPalette } from '../lib/theme';
import { spacing } from '../lib/theme';

type PriorityAction = {
  kind: 'event' | 'coverage' | 'requests' | 'stock' | 'steady';
  tone: 'good' | 'warn' | 'neutral';
  title: string;
  body: string;
  cta: string;
  route: '/reservations' | '/staff' | '/schedule' | '/bar-stock' | '/reports';
};

type CommandCenterSnapshot = {
  readiness?: { score: number; status: 'on-track' | 'at-risk' | 'blocked'; categories: Record<string, number> };
  blockers?: Array<{ code: string; severity: 'warning' | 'blocker'; title: string; detail: string; targetId?: string }>;
  events?: Array<{ _id: string; title: string; startsAt: number; expectedGuests: number | null; readiness: string }>;
  staffing?: { scheduled: number; open: number; covered: number };
  setup?: { prepOpen: number; checklistOpen: number };
};

export function OperationsAutopilotPanel({
  palette,
  priorityActions,
  commandCenter,
  onResolveBlocker,
}: {
  palette: DesignPalette;
  priorityActions: PriorityAction[] | null | undefined;
  commandCenter?: CommandCenterSnapshot | null;
  onResolveBlocker?: (blocker: { code: string; targetId?: string }) => void;
}) {
  const actions = priorityActions?.slice(0, 3) ?? [];
  const blockers = commandCenter?.blockers?.slice(0, 4) ?? [];
  const readiness = commandCenter?.readiness;
  const pillTone = actions[0]?.tone ?? 'good';
  const kindLabel = (kind: PriorityAction['kind']) => {
    if (kind === 'event') return 'Event prep';
    if (kind === 'coverage') return 'Coverage';
    if (kind === 'requests') return 'Requests';
    if (kind === 'stock') return 'Inventory';
    return 'Clear';
  };

  return (
    <CommandSurface palette={palette} strong style={{ gap: spacing.md, borderColor: palette.primary }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
        <View style={{ flex: 1, minWidth: 220 }}>
          <CommandText palette={palette} variant="label">Command center</CommandText>
          <CommandText palette={palette} variant="title">Operational autopilot</CommandText>
          <CommandText palette={palette} variant="caption">Live readiness across bookings, staffing, setup, floor assignments, and event briefs.</CommandText>
        </View>
        <StatusPill palette={palette} tone={readiness?.status === 'blocked' || readiness?.status === 'at-risk' ? 'warn' : pillTone}>
          {readiness ? `${readiness.score}% ready` : actions.length > 0 ? `${actions.length} priorities` : 'Clear'}
        </StatusPill>
      </View>

      {readiness ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {Object.entries(readiness.categories).map(([key, value]) => (
            <View key={key} style={{ flexGrow: 1, flexBasis: 110, padding: spacing.sm, borderRadius: 10, backgroundColor: palette.surfaceSoft }}>
              <CommandText palette={palette} variant="metric">{`${value}%`}</CommandText>
              <CommandText palette={palette} variant="caption">{key.replace(/-/g, ' ')}</CommandText>
            </View>
          ))}
        </View>
      ) : null}

      {blockers.length > 0 ? (
        <View style={{ gap: spacing.xs }}>
          <CommandText palette={palette} variant="label">Action queue</CommandText>
          {blockers.map((blocker) => (
            <View key={`${blocker.code}-${blocker.title}`} style={{ padding: spacing.sm, borderRadius: 10, backgroundColor: blocker.severity === 'blocker' ? '#FDE7E9' : palette.surfaceSoft }}>
              <CommandText palette={palette} variant="body">{blocker.title}</CommandText>
              <CommandText palette={palette} variant="caption">{blocker.detail}</CommandText>
              {blocker.code === 'OPEN_EXECUTION_TASK' && blocker.targetId && onResolveBlocker ? (
                <CommandButton palette={palette} icon="check" onPress={() => onResolveBlocker(blocker)} style={{ alignSelf: 'flex-start' }}>
                  Mark complete
                </CommandButton>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {commandCenter?.events?.length ? (
        <View style={{ gap: spacing.xs }}>
          <CommandText palette={palette} variant="label">Today’s event run</CommandText>
          {commandCenter.events.slice(0, 4).map((event) => (
            <View key={event._id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <CommandText palette={palette} variant="body" style={{ flex: 1 }}>{event.title}</CommandText>
              <CommandText palette={palette} variant="caption">{event.expectedGuests ?? '—'} guests</CommandText>
              <StatusPill palette={palette} tone={event.readiness === 'ready' ? 'good' : 'warn'}>{event.readiness}</StatusPill>
              <CommandButton palette={palette} icon="arrow-right" onPress={() => router.push({ pathname: '/event-command-center', params: { eventId: event._id } })}>
                Open
              </CommandButton>
            </View>
          ))}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {actions.length === 0 ? (
          <View style={{ flex: 1, gap: spacing.xs, padding: spacing.md, borderRadius: 10, backgroundColor: palette.surfaceSoft }}>
            <MaterialCommunityIcons name="check-circle-outline" size={20} color={palette.success} />
            <CommandText palette={palette} variant="body">No urgent actions right now.</CommandText>
            <CommandText palette={palette} variant="caption">When the brief picks up, this will surface the next move automatically.</CommandText>
          </View>
        ) : actions.map((action, index) => (
            <View key={`${action.kind}-${action.title}`} style={{ flexGrow: 1, flexBasis: 220, gap: spacing.xs, padding: spacing.md, borderRadius: 10, backgroundColor: palette.surfaceSoft }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs }}>
              <StatusPill palette={palette} tone={action.tone}>{`${index + 1}. ${kindLabel(action.kind)}`}</StatusPill>
              <MaterialCommunityIcons
                name={action.kind === 'event' ? 'calendar-star' : action.kind === 'coverage' ? 'account-group-outline' : action.kind === 'requests' ? 'playlist-check' : action.kind === 'stock' ? 'glass-cocktail' : 'star-outline'}
                size={18}
                color={action.tone === 'warn' ? palette.warning : action.tone === 'good' ? palette.success : palette.primary}
              />
            </View>
            <CommandText palette={palette} variant="body">{action.title}</CommandText>
            <CommandText palette={palette} variant="caption">{action.body}</CommandText>
            <CommandButton palette={palette} icon="arrow-right" onPress={() => router.push(action.route)} style={{ alignSelf: 'flex-start' }}>
              {action.cta}
            </CommandButton>
          </View>
        ))}
      </View>
    </CommandSurface>
  );
}
