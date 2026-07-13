import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { CommandButton, CommandSurface, CommandText, StatusPill } from './FutureUI';
import type { DesignPalette } from '../lib/theme';
import { spacing } from '../lib/theme';
import { formatDuration, formatMoney } from '../lib/format';

type RecoveryAction = {
  kind: 'labor' | 'coverage' | 'schedule' | 'inventory' | 'floor' | 'steady';
  tone: 'good' | 'warn' | 'neutral';
  title: string;
  body: string;
  cta: string;
  route: '/floor' | '/reports' | '/reservations' | '/schedule' | '/staff' | '/bar-stock';
};

type ProfitabilityPulse = {
  tone: 'good' | 'warn' | 'neutral';
  headline: string;
  detail: string;
  salesCents: number;
  laborHours: number;
  salesPerLaborHourCents: number | null;
  openChecks: number;
  activeClocks: number;
  recoveryActions: RecoveryAction[];
};

export function ProfitabilityPulsePanel({
  palette,
  pulse,
}: {
  palette: DesignPalette;
  pulse: ProfitabilityPulse | null | undefined;
}) {
  if (!pulse) return null;
  const actions = pulse.recoveryActions.slice(0, 3);

  return (
    <CommandSurface palette={palette} strong style={{ gap: spacing.md, borderColor: pulse.tone === 'warn' ? palette.warning : palette.primary }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
        <View style={{ flex: 1, minWidth: 220 }}>
          <CommandText palette={palette} variant="label">Profitability pulse</CommandText>
          <CommandText palette={palette} variant="title">{pulse.headline}</CommandText>
          <CommandText palette={palette} variant="caption">{pulse.detail}</CommandText>
        </View>
        <StatusPill palette={palette} tone={pulse.tone}>
          {pulse.salesPerLaborHourCents == null ? 'No labor data' : `${formatMoney(pulse.salesPerLaborHourCents)}/hr`}
        </StatusPill>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {[
          { label: 'Sales today', value: formatMoney(pulse.salesCents), icon: 'cash-multiple' as const },
          { label: 'Labor hours', value: formatDuration(Math.round(pulse.laborHours * 60)), icon: 'account-clock-outline' as const },
          { label: 'Open checks', value: String(pulse.openChecks), icon: 'receipt-text-outline' as const },
          { label: 'Active clocks', value: String(pulse.activeClocks), icon: 'clock-outline' as const },
        ].map((item) => (
          <View key={item.label} style={{ flexGrow: 1, flexBasis: 150, gap: 4, padding: spacing.md, borderRadius: 10, backgroundColor: palette.surfaceSoft }}>
            <MaterialCommunityIcons name={item.icon} size={18} color={palette.primary} />
            <CommandText palette={palette} variant="metric">{item.value}</CommandText>
            <CommandText palette={palette} variant="caption">{item.label}</CommandText>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {actions.map((action, index) => (
          <View key={`${action.kind}-${action.title}`} style={{ flexGrow: 1, flexBasis: 220, gap: spacing.xs, padding: spacing.md, borderRadius: 10, backgroundColor: palette.surfaceSoft }}>
            <StatusPill palette={palette} tone={action.tone}>{`${index + 1}. ${action.kind}`}</StatusPill>
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
