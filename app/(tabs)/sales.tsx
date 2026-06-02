import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, Chip, SegmentedButtons, Text } from 'react-native-paper';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { accents, colors, spacing } from '../../lib/theme';
import { useAuthStore, type AuthState } from '../../lib/auth-store';
import { useAuthenticatedSession } from '../../lib/auth-readiness';
import { canManageVenue } from '../../lib/permissions';
import { ScheduleSkeleton } from '../../components/schedule/ScheduleSkeleton';
import { PremiumFeatureGate } from '../../components/PremiumFeatureGate';

type WindowOption = { label: string; days: number };
const WINDOWS: WindowOption[] = [
  { label: 'Today', days: 1 },
  { label: '7 d', days: 7 },
  { label: '30 d', days: 30 },
];

function dollars(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(part: number, whole: number) {
  if (!whole) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

function mins(m: number | null) {
  if (m == null) return '—';
  return m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
}

function minsToHours(m: number) {
  const h = Math.floor(m / 60);
  const rem = Math.round(m % 60);
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

// A simple bar chart rendered as relative-width View bands.
function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? value / max : 0;
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' }}>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: color, width: `${Math.max(2, Math.round(pct * 100))}%` }} />
    </View>
  );
}

function KpiTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: typeof accents[number] }) {
  return (
    <Card style={{ backgroundColor: accent.bg, borderRadius: 14, minWidth: '47%', flexGrow: 1 }}>
      <Card.Content style={{ gap: 2 }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: accent.fg }}>{value}</Text>
        {sub ? <Text style={{ fontSize: 12, color: colors.muted }}>{sub}</Text> : null}
        <Text style={{ fontSize: 12, color: colors.muted }}>{label}</Text>
      </Card.Content>
    </Card>
  );
}

type SalesTabProps = { venueId: Id<'venues'>; days: number };

function SummaryTab({ venueId, days }: SalesTabProps) {
  const dashboard = useQuery(api.pos.getSalesSummaryDashboard, { venueId, windowDays: days });

  if (dashboard === undefined) return <ScheduleSkeleton rows={5} />;

  if (!dashboard || dashboard.summary.checkCount === 0) {
    return (
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content>
          <Text style={{ color: colors.muted }}>No sales data for this period. Connect a POS integration to start receiving data.</Text>
        </Card.Content>
      </Card>
    );
  }

  const { summary, byDay, byTender, byRevenueCenter } = dashboard;
  const netSales = summary.salesCents - (summary.discountCents + summary.compCents + summary.promoCents);
  const maxDay = Math.max(...byDay.map((d) => d.salesCents), 1);

  return (
    <View style={{ gap: spacing.md }}>
      {/* KPI grid */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <KpiTile label="Gross sales" value={dollars(summary.salesCents)} accent={accents[0]} />
        <KpiTile label="Net sales" value={dollars(netSales)} sub={`after ${dollars(summary.discountCents + summary.compCents + summary.promoCents)} off`} accent={accents[2]} />
        <KpiTile label="Tips collected" value={dollars(summary.tipCents)} sub={pct(summary.tipCents, summary.salesCents) + ' of sales'} accent={accents[1]} />
        <KpiTile label="Tax" value={dollars(summary.taxCents)} accent={accents[4]} />
        <KpiTile label="Checks" value={String(summary.checkCount)} sub={`avg ${dollars(summary.avgCheckCents)}`} accent={accents[3]} />
        <KpiTile label="Covers" value={String(summary.coverCount)} sub={summary.coverCount ? `avg ${dollars(Math.round(summary.salesCents / summary.coverCount))}/cover` : undefined} accent={accents[0]} />
      </View>

      {/* Discounts / comps / promos */}
      {(summary.discountCents + summary.compCents + summary.promoCents) > 0 ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleSmall" style={{ fontWeight: '700' }}>Discounts & voids</Text>
            {[
              { label: 'Discounts', value: summary.discountCents },
              { label: 'Comps', value: summary.compCents },
              { label: 'Promos', value: summary.promoCents },
            ].filter((r) => r.value > 0).map((r) => (
              <View key={r.label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.muted }}>{r.label}</Text>
                <Text style={{ color: colors.danger, fontWeight: '700' }}>-{dollars(r.value)}</Text>
              </View>
            ))}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs }}>
              <Text style={{ fontWeight: '700' }}>Total off</Text>
              <Text style={{ color: colors.danger, fontWeight: '800' }}>-{dollars(summary.discountCents + summary.compCents + summary.promoCents)}</Text>
            </View>
          </Card.Content>
        </Card>
      ) : null}

      {/* Daily sparkline */}
      {byDay.length > 1 ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleSmall" style={{ fontWeight: '700' }}>Sales by day</Text>
            {byDay.map((d) => (
              <View key={d.date} style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{d.date}</Text>
                  <Text style={{ fontSize: 12, fontWeight: '700' }}>{dollars(d.salesCents)}</Text>
                </View>
                <MiniBar value={d.salesCents} max={maxDay} color={colors.primary} />
              </View>
            ))}
          </Card.Content>
        </Card>
      ) : null}

      {/* Tender mix */}
      {byTender.length > 0 ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleSmall" style={{ fontWeight: '700' }}>Tender mix</Text>
            {byTender.map((t, i) => (
              <View key={t.tenderType} style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.charcoal }}>{t.tenderType}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{dollars(t.salesCents)} · {pct(t.salesCents, summary.salesCents)}</Text>
                </View>
                <MiniBar value={t.salesCents} max={summary.salesCents} color={accents[i % accents.length].fg} />
              </View>
            ))}
          </Card.Content>
        </Card>
      ) : null}

      {/* Revenue centers */}
      {byRevenueCenter.length > 1 ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleSmall" style={{ fontWeight: '700' }}>Revenue centers</Text>
            {byRevenueCenter.map((r, i) => (
              <View key={r.revenueCenter} style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.charcoal }}>{r.revenueCenter}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{dollars(r.salesCents)} · {r.checkCount} checks</Text>
                </View>
                <MiniBar value={r.salesCents} max={summary.salesCents} color={accents[i % accents.length].fg} />
              </View>
            ))}
          </Card.Content>
        </Card>
      ) : null}

      {/* Avg check time */}
      {summary.avgCheckTimeMins != null ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
          <Card.Content>
            <Text variant="titleSmall" style={{ fontWeight: '700' }}>Avg table turn</Text>
            <Text style={{ fontSize: 28, fontWeight: '800', color: colors.primary, marginTop: 4 }}>{mins(summary.avgCheckTimeMins)}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>From check open to close on paid checks</Text>
          </Card.Content>
        </Card>
      ) : null}
    </View>
  );
}

function ServersTab({ venueId, days }: SalesTabProps) {
  const data = useQuery(api.pos.getSalesByServer, { venueId, windowDays: days });

  if (data === undefined) return <ScheduleSkeleton rows={4} />;
  if (!data || data.length === 0) {
    return (
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content><Text style={{ color: colors.muted }}>No server data for this period.</Text></Card.Content>
      </Card>
    );
  }

  const maxSales = Math.max(...data.map((r) => r.salesCents), 1);

  return (
    <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
      <Card.Content style={{ gap: spacing.md }}>
        <Text variant="titleMedium" style={{ fontWeight: '700' }}>By server</Text>
        {data.map((r, i) => (
          <View key={r.serverName} style={{ gap: 6, paddingBottom: spacing.sm, borderBottomWidth: i < data.length - 1 ? 1 : 0, borderBottomColor: colors.border }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '700', flex: 1 }} numberOfLines={1}>{r.serverName}</Text>
              <Text style={{ fontSize: 16, fontWeight: '800', color: colors.primary }}>{dollars(r.salesCents)}</Text>
            </View>
            <MiniBar value={r.salesCents} max={maxSales} color={accents[i % accents.length].fg} />
            <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
              <Chip compact style={{ backgroundColor: accents[0].bg }}>
                <Text style={{ fontSize: 11, color: accents[0].fg }}>{r.checkCount} checks</Text>
              </Chip>
              <Chip compact style={{ backgroundColor: accents[2].bg }}>
                <Text style={{ fontSize: 11, color: accents[2].fg }}>{r.coverCount} covers</Text>
              </Chip>
              <Chip compact style={{ backgroundColor: accents[1].bg }}>
                <Text style={{ fontSize: 11, color: accents[1].fg }}>avg {dollars(r.avgCheckCents)}</Text>
              </Chip>
              {r.tipCents > 0 ? (
                <Chip compact style={{ backgroundColor: accents[3].bg }}>
                  <Text style={{ fontSize: 11, color: accents[3].fg }}>{dollars(r.tipCents)} tips</Text>
                </Chip>
              ) : null}
              {r.compCents + r.discountCents > 0 ? (
                <Chip compact style={{ backgroundColor: '#FDE7E9' }}>
                  <Text style={{ fontSize: 11, color: colors.danger }}>-{dollars(r.compCents + r.discountCents)} off</Text>
                </Chip>
              ) : null}
            </View>
          </View>
        ))}
      </Card.Content>
    </Card>
  );
}

function ItemsTab({ venueId, days }: SalesTabProps) {
  const data = useQuery(api.pos.getTopMenuItems, { venueId, windowDays: days, limit: 30 });

  if (data === undefined) return <ScheduleSkeleton rows={4} />;
  if (!data || data.length === 0) {
    return (
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content><Text style={{ color: colors.muted }}>No menu item data yet. Make sure your POS integration transmits line-item detail.</Text></Card.Content>
      </Card>
    );
  }

  const maxSales = Math.max(...data.map((r) => r.salesCents), 1);
  const categories = Array.from(new Set(data.map((r) => r.category).filter(Boolean))) as string[];

  return (
    <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
      <Card.Content style={{ gap: spacing.md }}>
        <Text variant="titleMedium" style={{ fontWeight: '700' }}>Top items by revenue</Text>
        {categories.length > 1
          ? categories.map((cat) => (
            <View key={cat} style={{ gap: spacing.sm }}>
              <Text style={{ fontWeight: '700', color: colors.muted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>{cat}</Text>
              {data.filter((r) => r.category === cat).map((r, i) => (
                <ItemRow key={r.name} r={r} i={i} maxSales={maxSales} />
              ))}
            </View>
          ))
          : data.map((r, i) => <ItemRow key={r.name} r={r} i={i} maxSales={maxSales} />)
        }
      </Card.Content>
    </Card>
  );
}

function ItemRow({ r, i, maxSales }: { r: { name: string; category: string | null; quantity: number; salesCents: number }; i: number; maxSales: number }) {
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ flex: 1, color: colors.charcoal }} numberOfLines={1}>{r.name}</Text>
        <Text style={{ fontSize: 13, fontWeight: '700' }}>{dollars(r.salesCents)}</Text>
      </View>
      <MiniBar value={r.salesCents} max={maxSales} color={accents[i % accents.length].fg} />
      <Text style={{ color: colors.muted, fontSize: 11 }}>Qty {r.quantity} · avg {dollars(Math.round(r.salesCents / r.quantity))}</Text>
    </View>
  );
}

function LaborTab({ venueId, days }: SalesTabProps) {
  const data = useQuery(api.pos.getLaborSummary, { venueId, windowDays: days });

  if (data === undefined) return <ScheduleSkeleton rows={4} />;
  if (!data || data.byEmployee.length === 0) {
    return (
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content><Text style={{ color: colors.muted }}>No labor data for this period. Configure the /pos/labor webhook endpoint to receive punch data.</Text></Card.Content>
      </Card>
    );
  }

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <KpiTile label="Regular hours" value={minsToHours(data.totalRegularMins)} accent={accents[0]} />
        <KpiTile label="Overtime hours" value={minsToHours(data.totalOvertimeMins)} sub={data.totalOvertimeMins > 0 ? 'review scheduling' : undefined} accent={data.totalOvertimeMins > 0 ? accents[5] : accents[4]} />
        <KpiTile label="Total pay" value={dollars(data.totalPayCents)} accent={accents[2]} />
        <KpiTile label="Tips paid out" value={dollars(data.totalTipsCents)} accent={accents[1]} />
      </View>

      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.md }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>By employee</Text>
          {data.byEmployee.map((emp, i) => (
            <View key={emp.employeeName + i} style={{ gap: 6, paddingBottom: spacing.sm, borderBottomWidth: i < data.byEmployee.length - 1 ? 1 : 0, borderBottomColor: colors.border }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700' }} numberOfLines={1}>{emp.employeeName}</Text>
                  {emp.jobTitle ? <Text style={{ color: colors.muted, fontSize: 12 }}>{emp.jobTitle}</Text> : null}
                </View>
                <Text style={{ fontWeight: '800', color: colors.primary }}>{dollars(emp.payCents)}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                <Chip compact style={{ backgroundColor: accents[0].bg }}>
                  <Text style={{ fontSize: 11, color: accents[0].fg }}>{minsToHours(emp.regularMins)} reg</Text>
                </Chip>
                {emp.overtimeMins > 0 ? (
                  <Chip compact style={{ backgroundColor: '#FDE7E9' }}>
                    <Text style={{ fontSize: 11, color: colors.danger }}>{minsToHours(emp.overtimeMins)} OT</Text>
                  </Chip>
                ) : null}
                {emp.tipsCents > 0 ? (
                  <Chip compact style={{ backgroundColor: accents[1].bg }}>
                    <Text style={{ fontSize: 11, color: accents[1].fg }}>{dollars(emp.tipsCents)} tips</Text>
                  </Chip>
                ) : null}
              </View>
            </View>
          ))}
        </Card.Content>
      </Card>
    </View>
  );
}

export default function SalesScreen() {
  const venue = useAuthStore((state: AuthState) => state.venue);
  const { isReady, user } = useAuthenticatedSession();
  const me = useQuery(api.app.getMe, isReady ? {} : 'skip');
  const canManage = canManageVenue(me?.profile.role ?? user?.role, me?.profile.allAccess ?? user?.all_access);

  const [tab, setTab] = useState<'summary' | 'servers' | 'items' | 'labor'>('summary');
  const [windowIdx, setWindowIdx] = useState(0);
  const window = WINDOWS[windowIdx];

  if (!canManage) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={{ color: colors.muted }}>Sales analytics are available to managers and admins.</Text>
      </ScrollView>
    );
  }

  if (!venue?.id) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg }}>
        <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
          <Card.Content>
            <Text style={{ color: colors.muted }}>No venue assigned to your account yet.</Text>
          </Card.Content>
        </Card>
      </ScrollView>
    );
  }

  return (
    <PremiumFeatureGate feature="pos_analytics">
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 64 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={{ gap: 4 }}>
          <Text variant="headlineMedium" style={{ color: colors.primary, fontWeight: '800' }}>Sales</Text>
          <Text style={{ color: colors.muted }}>{venue.name ?? 'Venue'} · POS analytics</Text>
        </View>

        {/* Time window pills */}
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {WINDOWS.map((w, i) => (
            <Button
              key={w.label}
              compact
              mode={windowIdx === i ? 'contained' : 'outlined'}
              buttonColor={windowIdx === i ? colors.primary : undefined}
              textColor={windowIdx === i ? '#fff' : colors.primary}
              onPress={() => setWindowIdx(i)}
            >
              {w.label}
            </Button>
          ))}
        </View>

        {/* Tab switcher */}
        <SegmentedButtons
          value={tab}
          onValueChange={(v) => setTab(v as typeof tab)}
          buttons={[
            { value: 'summary', label: 'Summary' },
            { value: 'servers', label: 'Servers' },
            { value: 'items', label: 'Items' },
            { value: 'labor', label: 'Labor' },
          ]}
        />

        {/* Content */}
        {tab === 'summary' && <SummaryTab venueId={venue.id} days={window.days} />}
        {tab === 'servers' && <ServersTab venueId={venue.id} days={window.days} />}
        {tab === 'items' && <ItemsTab venueId={venue.id} days={window.days} />}
        {tab === 'labor' && <LaborTab venueId={venue.id} days={window.days} />}
      </ScrollView>
    </PremiumFeatureGate>
  );
}
