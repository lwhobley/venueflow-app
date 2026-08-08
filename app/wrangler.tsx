import { ScrollView, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { CommandButton, CommandText } from '../components/FutureUI';
import { Skeleton } from '../components/Skeleton';
import { spacing, useDesignTheme } from '../lib/theme';
import { useWrangler, type WranglerPriority, type WranglerSeverity } from '../lib/useWrangler';

function severityLabel(severity: WranglerSeverity) {
  if (severity === 'critical') return 'CRITICAL';
  if (severity === 'warning') return 'ATTENTION';
  if (severity === 'watch') return 'WATCH';
  return 'CLEAR';
}

function iconFor(priority: WranglerPriority) {
  if (priority.kind === 'coverage') return 'account-alert-outline' as const;
  if (priority.kind === 'stock') return 'bottle-wine-outline' as const;
  if (priority.kind === 'event') return 'calendar-clock-outline' as const;
  if (priority.kind === 'requests') return 'clipboard-clock-outline' as const;
  if (priority.kind === 'floor') return 'floor-plan' as const;
  return 'check-circle-outline' as const;
}

export default function WranglerScreen() {
  const palette = useDesignTheme();
  const wrangler = useWrangler(true);
  const snapshot = wrangler.data;

  if (wrangler.isError) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.background, padding: spacing.lg, justifyContent: 'center', gap: spacing.md }}>
        <MaterialCommunityIcons name="alert-circle-outline" size={32} color={palette.warning} />
        <CommandText palette={palette} variant="title">The Wrangler could not load</CommandText>
        <CommandText palette={palette} variant="body">The live service snapshot is unavailable right now. Existing operational screens are still available.</CommandText>
        <CommandButton palette={palette} onPress={() => router.back()}>Go back</CommandButton>
      </View>
    );
  }

  if (wrangler.isLoading || !snapshot) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.background, padding: spacing.lg, gap: spacing.md }}>
        <Skeleton height={34} borderRadius={8} />
        <Skeleton height={92} borderRadius={8} />
        <Skeleton height={180} borderRadius={8} />
      </View>
    );
  }

  const summary = snapshot.summary;
  const statusCopy = snapshot.status === 'critical'
    ? 'Immediate attention required'
    : snapshot.status === 'attention'
      ? 'Service needs attention'
      : snapshot.status === 'watch'
        ? 'Keep an eye on service'
        : 'Service is under control';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={{ paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.lg, backgroundColor: '#F5EFE4', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.divider }}>
        <CommandText palette={palette} variant="label" style={{ color: '#7A5A35' }}>{snapshot.venue.name}</CommandText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 }}>
          <MaterialCommunityIcons name="target" size={28} color="#7A5A35" />
          <CommandText palette={palette} variant="hero">The Wrangler</CommandText>
        </View>
        <CommandText palette={palette} variant="body" style={{ marginTop: spacing.sm, color: palette.muted }}>
          {statusCopy}. {snapshot.priorities.length} prioritized item{snapshot.priorities.length === 1 ? '' : 's'} in the current service picture.
        </CommandText>
      </View>

      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.lg }}>
        <View style={{ flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.divider, paddingVertical: spacing.md }}>
          {[
            ['Covers', String(summary.covers)],
            ['Reservations', String(summary.reservations)],
            ['VIPs', String(summary.vipArrivals)],
            ['Seated', String(summary.seatedTables ?? 0)],
          ].map(([label, value], index) => (
            <View key={label} style={{ flex: 1, paddingHorizontal: spacing.sm, borderLeftWidth: index ? StyleSheet.hairlineWidth : 0, borderColor: palette.divider, gap: 2 }}>
              <CommandText palette={palette} variant="title">{value}</CommandText>
              <CommandText palette={palette} variant="caption">{label}</CommandText>
            </View>
          ))}
        </View>

        <View style={{ gap: spacing.sm }}>
          <CommandText palette={palette} variant="title">Needs wrangling</CommandText>
          <CommandText palette={palette} variant="caption">Prioritized by operational impact, not by which module happened to notice first.</CommandText>
        </View>

        <View style={{ gap: spacing.md }}>
          {snapshot.priorities.map((priority) => {
            const isCritical = priority.severity === 'critical';
            const isWarning = priority.severity === 'warning';
            const accent = isCritical || isWarning ? palette.warning : priority.severity === 'watch' ? '#8A6B2D' : palette.success;
            const action = priority.actions[0];

            return (
              <View key={priority.id} style={{ backgroundColor: palette.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border, borderLeftWidth: 4, borderLeftColor: accent, padding: spacing.md, gap: spacing.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <MaterialCommunityIcons name={iconFor(priority)} size={22} color={accent} />
                  <View style={{ flex: 1 }}>
                    <CommandText palette={palette} variant="label" style={{ color: accent }}>{severityLabel(priority.severity)}</CommandText>
                    <CommandText palette={palette} variant="title">{priority.title}</CommandText>
                  </View>
                </View>

                <CommandText palette={palette} variant="body">{priority.body}</CommandText>

                <View style={{ backgroundColor: palette.background, padding: spacing.sm, borderRadius: 6, gap: 2 }}>
                  <CommandText palette={palette} variant="label">Why it matters</CommandText>
                  <CommandText palette={palette} variant="caption">{priority.reason}</CommandText>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
                  {action ? (
                    <CommandButton
                      palette={palette}
                      selected={priority.severity === 'critical' || priority.severity === 'warning'}
                      onPress={() => router.push(action.route)}
                    >
                      {action.label}
                    </CommandButton>
                  ) : null}
                  <CommandButton palette={palette} onPress={() => router.push(priority.route)}>
                    View details
                  </CommandButton>
                </View>
              </View>
            );
          })}
        </View>

        <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.divider, paddingTop: spacing.md, gap: 4 }}>
          <CommandText palette={palette} variant="label">Service risks</CommandText>
          <CommandText palette={palette} variant="caption">
            {summary.openShifts} open shifts · {summary.lowStockItems} low-stock items · {summary.eightySixItems} 86'd · {summary.pendingStaffRequests} pending staff requests
          </CommandText>
        </View>
      </View>
    </ScrollView>
  );
}
