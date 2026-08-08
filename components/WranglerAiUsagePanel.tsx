import { View } from 'react-native';
import { CommandText } from './FutureUI';
import { spacing, useDesignTheme } from '../lib/theme';
import { useWranglerAiUsage } from '../lib/useWrangler';

function money(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: value < 10 ? 2 : 0, maximumFractionDigits: 2 }).format(value);
}

function tokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function featureLabel(value: string) {
  return value.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export function WranglerAiUsagePanel() {
  const palette = useDesignTheme();
  const usage = useWranglerAiUsage(true);

  if (usage.isError) return null;

  return (
    <View style={{ gap: spacing.md, borderTopWidth: 1, borderColor: palette.divider, paddingTop: spacing.lg }}>
      <View style={{ gap: 3 }}>
        <CommandText palette={palette} variant="title">AI usage</CommandText>
        <CommandText palette={palette} variant="caption">Month-to-date usage for this venue. Cost is estimated from configured model rates.</CommandText>
      </View>

      {usage.isLoading || !usage.data ? (
        <CommandText palette={palette} variant="caption">Loading venue AI usage…</CommandText>
      ) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {[
              ['Estimated spend', money(usage.data.estimatedCostUsd)],
              ['AI requests', String(usage.data.requests)],
              ['Input tokens', tokens(usage.data.promptTokens)],
              ['Output tokens', tokens(usage.data.completionTokens)],
            ].map(([label, value]) => (
              <View key={label} style={{ minWidth: 135, flexGrow: 1, flexBasis: '45%', backgroundColor: '#F8F3EA', padding: spacing.md, gap: 3 }}>
                <CommandText palette={palette} variant="caption">{label}</CommandText>
                <CommandText palette={palette} variant="title">{value}</CommandText>
              </View>
            ))}
          </View>

          <View style={{ gap: spacing.sm }}>
            <CommandText palette={palette} variant="label">BY FEATURE / MODEL</CommandText>
            {usage.data.breakdown.length ? usage.data.breakdown.slice(0, 6).map((row) => (
              <View key={`${row.feature}:${row.model}`} style={{ borderTopWidth: 1, borderColor: palette.divider, paddingTop: spacing.sm, gap: 2 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
                  <CommandText palette={palette} variant="body" style={{ fontWeight: '700', flex: 1 }}>{featureLabel(row.feature)}</CommandText>
                  <CommandText palette={palette} variant="body">{money(row.estimatedCostUsd)}</CommandText>
                </View>
                <CommandText palette={palette} variant="caption">{row.model} · {row.requests} requests · {tokens(row.totalTokens)} tokens</CommandText>
              </View>
            )) : <CommandText palette={palette} variant="caption">No metered AI calls have been recorded for this venue this month.</CommandText>}
          </View>
        </>
      )}
    </View>
  );
}
