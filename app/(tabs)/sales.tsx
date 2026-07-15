import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Card, Chip, SegmentedButtons, Text } from 'react-native-paper';
import { ScreenErrorBoundary } from '../../components/ErrorBoundary';
import { AnimatedTab, SectionHeader } from '../../components/AppCard';
import { useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import type { Id } from '../../lib/ids';
import { accents, colors, radius, spacing } from '../../lib/theme';
import { useVenueAuth } from '../../lib/useVenueAuth';
import { formatMoney, formatPct, formatDuration } from '../../lib/format';
import { ScheduleSkeleton } from '../../components/schedule/ScheduleSkeleton';
import { PremiumFeatureGate } from '../../components/PremiumFeatureGate';
import { ManagerGate } from '../../components/ManagerGate';
import { DateRangeBar, useDateRange } from '../../components/DateRangeBar';



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
    <Card style={{ backgroundColor: accent.bg, borderRadius: radius.sharp, minWidth: '47%', flexGrow: 1 }}>
      <Card.Content style={{ gap: 2 }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: accent.fg }}>{value}</Text>
        {sub ? <Text style={{ fontSize: 12, color: colors.muted }}>{sub}</Text> : null}
        <Text style={{ fontSize: 12, color: colors.muted }}>{label}</Text>
      </Card.Content>
    </Card>
  );
}

type SalesTabProps = { venueId: Id<'venues'>; days: number; startTs: number; endTs: number };

function SummaryTab({ venueId, days, startTs, endTs }: SalesTabProps) {
  const dashboard = useQuery(api.pos.getSalesSummaryDashboard, { venueId, windowDays: days, startTs, endTs }) as any;

  if (dashboard === undefined) return <ScheduleSkeleton rows={5} />;

  if (!dashboard || dashboard.summary.checkCount === 0) {
    return (
      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content>
          <Text style={{ color: colors.muted }}>No sales data for this period. Connect a POS integration to start receiving data.</Text>
        </Card.Content>
      </Card>
    );
  }

  const { summary, byDay, byTender, byRevenueCenter } = dashboard as { summary: any; byDay: any[]; byTender: any[]; byRevenueCenter: any[] };
  const netSales = summary.salesCents - (summary.discountCents + summary.compCents + summary.promoCents);
  const maxDay = Math.max(...byDay.map((d) => d.salesCents), 1);

  return (
    <View style={{ gap: spacing.md }}>
      {/* KPI grid */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <KpiTile label="Gross sales" value={formatMoney(summary.salesCents)} accent={accents[0]} />
        <KpiTile label="Net sales" value={formatMoney(netSales)} sub={`after ${formatMoney(summary.discountCents + summary.compCents + summary.promoCents)} off`} accent={accents[2]} />
        <KpiTile label="Tips collected" value={formatMoney(summary.tipCents)} sub={formatPct(summary.tipCents, summary.salesCents) + ' of sales'} accent={accents[1]} />
        <KpiTile label="Tax" value={formatMoney(summary.taxCents)} accent={accents[4]} />
        <KpiTile label="Checks" value={String(summary.checkCount)} sub={`avg ${formatMoney(summary.avgCheckCents)}`} accent={accents[3]} />
        <KpiTile label="Covers" value={String(summary.coverCount)} sub={summary.coverCount ? `avg ${formatMoney(Math.round(summary.salesCents / summary.coverCount))}/cover` : undefined} accent={accents[0]} />
      </View>

      {/* Discounts / comps / promos */}
      {(summary.discountCents + summary.compCents + summary.promoCents) > 0 ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleSmall" style={{ fontWeight: '700' }}>Discounts & voids</Text>
            {[
              { label: 'Discounts', value: summary.discountCents },
              { label: 'Comps', value: summary.compCents },
              { label: 'Promos', value: summary.promoCents },
            ].filter((r) => r.value > 0).map((r) => (
              <View key={r.label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.muted }}>{r.label}</Text>
                <Text style={{ color: colors.danger, fontWeight: '700' }}>-{formatMoney(r.value)}</Text>
              </View>
            ))}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs }}>
              <Text style={{ fontWeight: '700' }}>Total off</Text>
              <Text style={{ color: colors.danger, fontWeight: '800' }}>-{formatMoney(summary.discountCents + summary.compCents + summary.promoCents)}</Text>
            </View>
          </Card.Content>
        </Card>
      ) : null}

      {/* Daily sparkline */}
      {byDay.length > 1 ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleSmall" style={{ fontWeight: '700' }}>Sales by day</Text>
            {byDay.map((d) => (
              <View key={d.date} style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{d.date}</Text>
                  <Text style={{ fontSize: 12, fontWeight: '700' }}>{formatMoney(d.salesCents)}</Text>
                </View>
                <MiniBar value={d.salesCents} max={maxDay} color={colors.primary} />
              </View>
            ))}
          </Card.Content>
        </Card>
      ) : null}

      {/* Tender mix */}
      {byTender.length > 0 ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleSmall" style={{ fontWeight: '700' }}>Tender mix</Text>
            {byTender.map((t, i) => (
              <View key={t.tenderType} style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.charcoal }}>{t.tenderType}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{formatMoney(t.salesCents)} · {formatPct(t.salesCents, summary.salesCents)}</Text>
                </View>
                <MiniBar value={t.salesCents} max={summary.salesCents} color={accents[i % accents.length].fg} />
              </View>
            ))}
          </Card.Content>
        </Card>
      ) : null}

      {/* Revenue centers */}
      {byRevenueCenter.length > 1 ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
          <Card.Content style={{ gap: spacing.sm }}>
            <Text variant="titleSmall" style={{ fontWeight: '700' }}>Revenue centers</Text>
            {byRevenueCenter.map((r, i) => (
              <View key={r.revenueCenter} style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.charcoal }}>{r.revenueCenter}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{formatMoney(r.salesCents)} · {r.checkCount} checks</Text>
                </View>
                <MiniBar value={r.salesCents} max={summary.salesCents} color={accents[i % accents.length].fg} />
              </View>
            ))}
          </Card.Content>
        </Card>
      ) : null}

      {/* Avg check time */}
      {summary.avgCheckTimeMins != null ? (
        <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
          <Card.Content>
            <Text variant="titleSmall" style={{ fontWeight: '700' }}>Avg table turn</Text>
            <Text style={{ fontSize: 28, fontWeight: '800', color: colors.primary, marginTop: 4 }}>{formatDuration(summary.avgCheckTimeMins)}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>From check open to close on paid checks</Text>
          </Card.Content>
        </Card>
      ) : null}
    </View>
  );
}

function ServersTab({ venueId, days, startTs, endTs }: SalesTabProps) {
  const data = useQuery(api.pos.getSalesByServer, { venueId, windowDays: days, startTs, endTs }) as any[] | undefined;

  if (data === undefined) return <ScheduleSkeleton rows={4} />;
  if (!data || data.length === 0) {
    return (
      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content><Text style={{ color: colors.muted }}>No server data for this period.</Text></Card.Content>
      </Card>
    );
  }

  const maxSales = Math.max(...data.map((r) => r.salesCents), 1);

  return (
    <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
      <Card.Content style={{ gap: spacing.md }}>
        <Text variant="titleMedium" style={{ fontWeight: '700' }}>By server</Text>
        {data.map((r, i) => (
          <View key={r.serverName} style={{ gap: 6, paddingBottom: spacing.sm, borderBottomWidth: i < data.length - 1 ? 1 : 0, borderBottomColor: colors.border }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '700', flex: 1 }} numberOfLines={1}>{r.serverName}</Text>
              <Text style={{ fontSize: 16, fontWeight: '800', color: colors.primary }}>{formatMoney(r.salesCents)}</Text>
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
                <Text style={{ fontSize: 11, color: accents[1].fg }}>avg {formatMoney(r.avgCheckCents)}</Text>
              </Chip>
              {r.tipCents > 0 ? (
                <Chip compact style={{ backgroundColor: accents[3].bg }}>
                  <Text style={{ fontSize: 11, color: accents[3].fg }}>{formatMoney(r.tipCents)} tips</Text>
                </Chip>
              ) : null}
              {r.compCents + r.discountCents > 0 ? (
                <Chip compact style={{ backgroundColor: `${colors.danger}1A` }}>
                  <Text style={{ fontSize: 11, color: colors.danger }}>-{formatMoney(r.compCents + r.discountCents)} off</Text>
                </Chip>
              ) : null}
            </View>
          </View>
        ))}
      </Card.Content>
    </Card>
  );
}

function ItemsTab({ venueId, days, startTs, endTs }: SalesTabProps) {
  const data = useQuery(api.pos.getTopMenuItems, { venueId, windowDays: days, limit: 30, startTs, endTs }) as any[] | undefined;

  if (data === undefined) return <ScheduleSkeleton rows={4} />;
  if (!data || data.length === 0) {
    return (
      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content><Text style={{ color: colors.muted }}>No menu item data yet. Make sure your POS integration transmits line-item detail.</Text></Card.Content>
      </Card>
    );
  }

  const maxSales = Math.max(...data.map((r) => r.salesCents), 1);
  const categories = Array.from(new Set(data.map((r) => r.category).filter(Boolean))) as string[];

  return (
    <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
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
        <Text style={{ fontSize: 13, fontWeight: '700' }}>{formatMoney(r.salesCents)}</Text>
      </View>
      <MiniBar value={r.salesCents} max={maxSales} color={accents[i % accents.length].fg} />
      <Text style={{ color: colors.muted, fontSize: 11 }}>Qty {r.quantity} · avg {formatMoney(Math.round(r.salesCents / r.quantity))}</Text>
    </View>
  );
}

function LaborTab({ venueId, days, startTs, endTs }: SalesTabProps) {
  const data = useQuery(api.pos.getLaborSummary, { venueId, windowDays: days, startTs, endTs }) as any;

  if (data === undefined) return <ScheduleSkeleton rows={4} />;
  if (!data || data.byEmployee.length === 0) {
    return (
      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content><Text style={{ color: colors.muted }}>No labor data for this period. Configure the /pos/labor webhook endpoint to receive punch data.</Text></Card.Content>
      </Card>
    );
  }

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <KpiTile label="Regular hours" value={formatDuration(data.totalRegularMins)} accent={accents[0]} />
        <KpiTile label="Overtime hours" value={formatDuration(data.totalOvertimeMins)} sub={data.totalOvertimeMins > 0 ? 'review scheduling' : undefined} accent={data.totalOvertimeMins > 0 ? accents[5] : accents[4]} />
        <KpiTile label="Total pay" value={formatMoney(data.totalPayCents)} accent={accents[2]} />
        <KpiTile label="Tips paid out" value={formatMoney(data.totalTipsCents)} accent={accents[1]} />
      </View>

      <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
        <Card.Content style={{ gap: spacing.md }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>By employee</Text>
          {((data.byEmployee ?? []) as any[]).map((emp, i) => (
            <View key={emp.employeeName + i} style={{ gap: 6, paddingBottom: spacing.sm, borderBottomWidth: i < data.byEmployee.length - 1 ? 1 : 0, borderBottomColor: colors.border }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700' }} numberOfLines={1}>{emp.employeeName}</Text>
                  {emp.jobTitle ? <Text style={{ color: colors.muted, fontSize: 12 }}>{emp.jobTitle}</Text> : null}
                </View>
                <Text style={{ fontWeight: '800', color: colors.primary }}>{formatMoney(emp.payCents)}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                <Chip compact style={{ backgroundColor: accents[0].bg }}>
                  <Text style={{ fontSize: 11, color: accents[0].fg }}>{formatDuration(emp.regularMins)} reg</Text>
                </Chip>
                {emp.overtimeMins > 0 ? (
                  <Chip compact style={{ backgroundColor: `${colors.danger}1A` }}>
                    <Text style={{ fontSize: 11, color: colors.danger }}>{formatDuration(emp.overtimeMins)} OT</Text>
                  </Chip>
                ) : null}
                {emp.tipsCents > 0 ? (
                  <Chip compact style={{ backgroundColor: accents[1].bg }}>
                    <Text style={{ fontSize: 11, color: accents[1].fg }}>{formatMoney(emp.tipsCents)} tips</Text>
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

export default function SalesScreenWrapper() {
  return <ScreenErrorBoundary><SalesScreen /></ScreenErrorBoundary>;
}

function SalesScreen() {
  const { venue, isReady, profileLoading, canManage } = useVenueAuth();

  const [tab, setTab] = useState<'summary' | 'servers' | 'items' | 'labor'>('summary');
  const { selected: dateRange, setSelected: setDateRange, presets } = useDateRange('today');

  if (!venue?.id) {
    return (
      <ManagerGate canManage={canManage} profileLoading={profileLoading} feature="Sales analytics">
        <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg }}>
          <Card style={{ backgroundColor: colors.surface, borderRadius: radius.sharp }}>
            <Card.Content>
              <Text style={{ color: colors.muted }}>No venue assigned to your account yet.</Text>
            </Card.Content>
          </Card>
        </ScrollView>
      </ManagerGate>
    );
  }

  return (
    <ManagerGate canManage={canManage} profileLoading={profileLoading} feature="Sales analytics">
    <PremiumFeatureGate feature="pos_analytics">
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 64 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <SectionHeader
          kicker="Performance"
          title="Sales"
          subtitle={`${venue.name ?? 'Venue'} · POS analytics`}
          trailing={<DateRangeBar selected={dateRange} presets={presets} onSelect={setDateRange} />}
        />

        {/* Tab switcher */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ minWidth: 620 }}>
          <SegmentedButtons
            value={tab}
            onValueChange={(v) => setTab(v as typeof tab)}
            style={{ minWidth: 620 }}
            buttons={[
              { value: 'summary', label: 'Summary' },
              { value: 'servers', label: 'Servers' },
              { value: 'items', label: 'Items' },
              { value: 'labor', label: 'Labor' },
            ]}
          />
        </ScrollView>

        {/* Content */}
        <AnimatedTab tabKey={tab}>
          {tab === 'summary' && <SummaryTab venueId={venue.id} days={dateRange.days} startTs={dateRange.startTs} endTs={dateRange.endTs} />}
          {tab === 'servers' && <ServersTab venueId={venue.id} days={dateRange.days} startTs={dateRange.startTs} endTs={dateRange.endTs} />}
          {tab === 'items' && <ItemsTab venueId={venue.id} days={dateRange.days} startTs={dateRange.startTs} endTs={dateRange.endTs} />}
          {tab === 'labor' && <LaborTab venueId={venue.id} days={dateRange.days} startTs={dateRange.startTs} endTs={dateRange.endTs} />}
        </AnimatedTab>
      </ScrollView>
    </PremiumFeatureGate>
    </ManagerGate>
  );
}
