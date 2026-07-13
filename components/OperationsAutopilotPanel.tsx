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

export function OperationsAutopilotPanel({
  palette,
  priorityActions,
}: {
  palette: DesignPalette;
  priorityActions: PriorityAction[] | null | undefined;
}) {
  const actions = priorityActions?.slice(0, 3) ?? [];
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
          <CommandText palette={palette} variant="caption">Ranked next steps for event prep, staffing, requests, and inventory.</CommandText>
        </View>
        <StatusPill palette={palette} tone={pillTone}>
          {actions.length > 0 ? `${actions.length} priorities` : 'Clear'}
        </StatusPill>
      </View>

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
