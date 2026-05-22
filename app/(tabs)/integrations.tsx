import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, Chip, Text, TextInput } from 'react-native-paper';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { accents, colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';

const providers = ['toast', 'square', 'clover', 'generic'] as const;
type Provider = (typeof providers)[number];

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function dateTime(value: number | null | undefined) {
  return value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never';
}

export default function IntegrationsScreen() {
  const venue = useAuthStore((state: AuthState) => state.venue);
  const user = useAuthStore((state: AuthState) => state.user);
  const canManage = user?.role === 'admin' || user?.role === 'owner' || user?.role === 'manager';
  const overview = useQuery(api.pos.getPosOverview, canManage && venue?.id ? { venueId: venue.id } : 'skip') as any;
  const upsertConnection = useMutation(api.pos.upsertPosConnection);
  const importPosCheck = useMutation(api.pos.importPosCheck);

  const [provider, setProvider] = useState<Provider>('toast');
  const [locationId, setLocationId] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const saveConnection = async () => {
    if (!venue?.id) return;
    setSaving(true);
    setMessage(null);
    try {
      await upsertConnection({
        venueId: venue.id,
        provider,
        externalLocationId: locationId.trim() || undefined,
        status: 'connected',
      });
      setMessage('POS connection saved.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save POS connection.');
    } finally {
      setSaving(false);
    }
  };

  const importSample = async () => {
    if (!venue?.id) return;
    setSaving(true);
    setMessage(null);
    try {
      await importPosCheck({
        venueId: venue.id,
        provider,
        check: {
          externalCheckId: `manual-${Date.now()}`,
          tableLabel: '12',
          serverName: user?.full_name ?? 'Manager',
          guestName: 'Walk-in guest',
          openedAt: Date.now() - 45 * 60 * 1000,
          closedAt: Date.now(),
          subtotalCents: 8600,
          tipCents: 1720,
          totalCents: 10320,
          status: 'paid',
        },
      });
      setMessage('Sample POS check imported.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not import check.');
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={{ color: colors.muted }}>Integrations are available to managers and admins.</Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ gap: 4 }}>
        <Text variant="headlineMedium" style={{ color: colors.primary, fontWeight: '800' }}>Integrations</Text>
        <Text style={{ color: colors.muted }}>Connect POS sync and monitor provider activity for {venue?.name ?? 'your venue'}.</Text>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {[
          { label: 'Today sales', value: money(overview?.todaySalesCents ?? 0), a: accents[0] },
          { label: 'Today tips', value: money(overview?.todayTipsCents ?? 0), a: accents[2] },
          { label: 'Open checks', value: String(overview?.openChecks ?? 0), a: accents[3] },
          { label: 'Last sync', value: dateTime(overview?.lastSyncAt), a: accents[4] },
        ].map((metric) => (
          <Card key={metric.label} style={{ backgroundColor: metric.a.bg, width: '48%', flexGrow: 1, borderRadius: 16 }}>
            <Card.Content>
              <Text style={{ color: metric.a.fg, fontSize: 24, fontWeight: '800' }}>{metric.value}</Text>
              <Text style={{ color: colors.muted }}>{metric.label}</Text>
            </Card.Content>
          </Card>
        ))}
      </View>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>POS sync</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {providers.map((item) => (
              <Chip key={item} selected={provider === item} onPress={() => setProvider(item)}>{item}</Chip>
            ))}
          </View>
          <TextInput label="Provider location ID" value={locationId} onChangeText={setLocationId} mode="outlined" autoCapitalize="none" style={{ backgroundColor: colors.surface }} />
          {message ? <Text style={{ color: message.includes('Could') ? colors.danger : colors.muted }}>{message}</Text> : null}
          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
            <Button mode="contained" buttonColor={colors.primary} loading={saving} onPress={() => void saveConnection()}>Save connection</Button>
            <Button mode="outlined" textColor={colors.primary} loading={saving} onPress={() => void importSample()}>Import sample check</Button>
          </View>
          <Text style={{ color: colors.muted }}>Webhook endpoint: /pos/webhook with x-venueflow-pos-secret.</Text>
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Connections</Text>
          {(overview?.connections ?? []).length === 0 ? (
            <Text style={{ color: colors.muted }}>No POS provider connected yet.</Text>
          ) : (
            overview.connections.map((connection: any) => (
              <View key={connection._id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: 2 }}>
                <Text style={{ fontWeight: '700' }}>{connection.provider}</Text>
                <Text style={{ color: colors.muted }}>Status: {connection.status} · Location: {connection.externalLocationId ?? 'not set'}</Text>
                <Text style={{ color: colors.muted }}>Last sync: {dateTime(connection.lastSyncAt)}</Text>
              </View>
            ))
          )}
        </Card.Content>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>Recent checks</Text>
          {(overview?.recentChecks ?? []).length === 0 ? (
            <Text style={{ color: colors.muted }}>No POS checks have synced yet.</Text>
          ) : (
            overview.recentChecks.map((check: any) => (
              <View key={check._id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: 2 }}>
                <Text style={{ fontWeight: '700' }}>{check.provider} · {money(check.totalCents)}</Text>
                <Text style={{ color: colors.muted }}>{check.status} · Table {check.tableLabel ?? '-'} · {check.guestName ?? 'Guest'}</Text>
                <Text style={{ color: colors.muted }}>{dateTime(check.openedAt)}</Text>
              </View>
            ))
          )}
        </Card.Content>
      </Card>
    </ScrollView>
  );
}
