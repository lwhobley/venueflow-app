import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { CommandText } from './FutureUI';
import { spacing, useDesignTheme } from '../lib/theme';
import { useWrangler } from '../lib/useWrangler';

type Props = {
  enabled: boolean;
};

function statusLabel(status?: string) {
  if (status === 'critical') return 'IMMEDIATE ATTENTION';
  if (status === 'attention') return 'NEEDS WRANGLING';
  if (status === 'watch') return 'WATCH SERVICE';
  return 'SERVICE UNDER CONTROL';
}

export function HomeWranglerSurface({ enabled }: Props) {
  const palette = useDesignTheme();
  const wrangler = useWrangler(enabled);
  const snapshot = wrangler.data;

  if (!enabled) return null;

  if (wrangler.isLoading || !snapshot) {
    return (
      <View style={{ marginHorizontal: spacing.lg, marginTop: -1, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border, backgroundColor: palette.surface, padding: spacing.md }}>
        <CommandText palette={palette} variant="label">THE WRANGLER</CommandText>
        <CommandText palette={palette} variant="caption" style={{ marginTop: 4 }}>Building the live service picture…</CommandText>
      </View>
    );
  }

  const priority = snapshot.priorities[0];
  const urgent = priority?.severity === 'critical' || priority?.severity === 'warning';
  const accent = urgent ? palette.warning : priority?.severity === 'watch' ? '#8A6B2D' : palette.success;

  return (
    <Pressable
      onPress={() => router.push('/wrangler')}
      accessibilityRole="button"
      accessibilityLabel="Open The Wrangler"
      style={({ pressed }) => ({
        opacity: pressed ? 0.72 : 1,
        marginHorizontal: spacing.lg,
        marginTop: -1,
        backgroundColor: '#F8F3EA',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border,
        borderLeftWidth: 4,
        borderLeftColor: accent,
        padding: spacing.md,
        gap: spacing.sm,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}>
          <MaterialCommunityIcons name="target" size={22} color="#7A5A35" />
          <View style={{ flex: 1 }}>
            <CommandText palette={palette} variant="label" style={{ color: '#7A5A35' }}>THE WRANGLER · {statusLabel(snapshot.status)}</CommandText>
            <CommandText palette={palette} variant="title" style={{ marginTop: 2 }}>
              {priority?.title ?? 'Service is under control'}
            </CommandText>
          </View>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={22} color={palette.muted} />
      </View>

      <CommandText palette={palette} variant="body">
        {priority?.body ?? 'No active service conflicts need attention right now.'}
      </CommandText>

      {priority?.reason ? (
        <View style={{ paddingTop: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.divider }}>
          <CommandText palette={palette} variant="caption">Why it matters: {priority.reason}</CommandText>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.lg, paddingTop: 2 }}>
        <CommandText palette={palette} variant="caption">{snapshot.summary.covers} covers</CommandText>
        <CommandText palette={palette} variant="caption">{snapshot.summary.vipArrivals} VIPs</CommandText>
        <CommandText palette={palette} variant="caption">{snapshot.summary.seatedTables} seated</CommandText>
      </View>
    </Pressable>
  );
}
