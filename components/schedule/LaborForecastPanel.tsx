import { View } from 'react-native';
import { Card, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '../../lib/railway-hooks';
import { api } from '../../lib/railway-api';
import { accents, colors, spacing } from '../../lib/theme';
import { useAuthenticatedSession } from '../../lib/auth-readiness';

type DaypartRow = { key: string; label: string; covers: number; scheduledPeople: number };
type ForecastDay = {
  dayIndex: number;
  dayLabel: string;
  covers: number;
  privateEvents: number;
  scheduledPeople: number;
  scheduledHours: number;
  suggestedHours: number;
  gapHours: number;
  status: 'under' | 'balanced' | 'over';
  dayparts: DaypartRow[];
};
type Alert = { kind: string; severity: 'warning' | 'critical'; message: string; dayLabel?: string };
type OtRisk = { name: string; scheduledHours: number; overLimit: boolean };
type ForecastData = {
  days: ForecastDay[];
  totals: { covers: number; scheduledHours: number; suggestedHours: number; gapHours: number };
  alerts: Alert[];
  otRisk: OtRisk[];
};

const STATUS_COLOR: Record<ForecastDay['status'], string> = {
  under: colors.danger,
  over: colors.warning,
  balanced: colors.success,
};

const STATUS_LABEL: Record<ForecastDay['status'], string> = {
  under: 'Understaffed',
  over: 'Overstaffed',
  balanced: 'On track',
};

const ALERT_ICONS: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  understaffed: 'account-alert',
  overstaffed: 'account-minus',
  ot_risk: 'clock-alert',
  ot_violation: 'alert-circle',
};

function StatTile({ label, value, accent }: { label: string; value: string | number; accent?: { bg: string; fg: string } }) {
  return (
    <View style={{ flex: 1, minWidth: 80, backgroundColor: accent?.bg ?? colors.surface, borderRadius: 12, padding: spacing.sm, gap: 2 }}>
      <Text style={{ color: accent?.fg ?? colors.primary, fontSize: 22, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: colors.muted, fontSize: 11 }}>{label}</Text>
    </View>
  );
}

function DayBar({ day }: { day: ForecastDay }) {
  const pct = day.suggestedHours > 0 ? Math.min(1, day.scheduledHours / day.suggestedHours) : 1;
  const barColor = STATUS_COLOR[day.status];
  return (
    <View style={{ gap: 4, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <Text style={{ fontWeight: '700', minWidth: 36 }}>{day.dayLabel.slice(0, 3)}</Text>
          {day.privateEvents > 0 && (
            <View style={{ backgroundColor: accents[3].bg, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
              <Text style={{ color: accents[3].fg, fontSize: 11 }}>Private event</Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            {day.covers} covers · {day.scheduledPeople} staff · {day.scheduledHours}h/{day.suggestedHours}h
          </Text>
          <View style={{ backgroundColor: `${barColor}22`, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text style={{ color: barColor, fontSize: 11, fontWeight: '700' }}>{STATUS_LABEL[day.status]}</Text>
          </View>
        </View>
      </View>
      {/* Progress bar: scheduled vs. suggested */}
      <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: 'hidden' }}>
        <View style={{ height: 4, width: `${Math.round(pct * 100)}%`, backgroundColor: barColor, borderRadius: 2 }} />
      </View>
      {/* Daypart chips */}
      {day.dayparts.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
          {day.dayparts.map((dp) => (
            <View key={dp.key} style={{ backgroundColor: colors.surface, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, flexDirection: 'row', gap: 4, alignItems: 'center' }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>{dp.label}</Text>
              {dp.covers > 0 && <Text style={{ fontSize: 11, color: colors.charcoal }}>{dp.covers} cvr</Text>}
              {dp.scheduledPeople > 0 && <Text style={{ fontSize: 11, color: colors.primary }}>{dp.scheduledPeople} staff</Text>}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function AlertRow({ alert }: { alert: Alert }) {
  const iconName = ALERT_ICONS[alert.kind] ?? 'alert';
  const color = alert.severity === 'critical' ? colors.danger : colors.warning;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <MaterialCommunityIcons name={iconName} size={18} color={color} style={{ marginTop: 1 }} />
      <Text style={{ flex: 1, color: colors.charcoal, fontSize: 13 }}>{alert.message}</Text>
    </View>
  );
}

function OTRow({ risk }: { risk: OtRisk }) {
  const color = risk.overLimit ? colors.danger : colors.warning;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Text style={{ color: colors.charcoal, fontSize: 13 }}>{risk.name}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <MaterialCommunityIcons name={risk.overLimit ? 'alert-circle' : 'clock-alert'} size={16} color={color} />
        <Text style={{ color, fontWeight: '700', fontSize: 13 }}>{risk.scheduledHours}h</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{risk.overLimit ? '(over limit)' : '(approaching OT)'}</Text>
      </View>
    </View>
  );
}

export function LaborForecastPanel() {
  const { isReady } = useAuthenticatedSession();
  const forecast = useQuery(api.scheduling.getLaborForecast, isReady ? {} : 'skip') as ForecastData | null | undefined;

  if (forecast === undefined) {
    return (
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content>
          <Text style={{ color: colors.muted }}>Loading forecast…</Text>
        </Card.Content>
      </Card>
    );
  }

  if (!forecast) {
    return (
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content>
          <Text style={{ color: colors.muted }}>No forecast data available.</Text>
        </Card.Content>
      </Card>
    );
  }

  const gapColor = forecast.totals.gapHours > 0 ? colors.danger : forecast.totals.gapHours < -6 ? colors.warning : colors.success;

  return (
    <View style={{ gap: spacing.md }}>
      {/* Summary totals */}
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="titleMedium" style={{ fontWeight: '700' }}>7-Day Labor Outlook</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <StatTile label="Total covers" value={forecast.totals.covers} accent={accents[0]} />
            <StatTile label="Scheduled" value={`${forecast.totals.scheduledHours}h`} accent={accents[2]} />
            <StatTile label="Suggested" value={`${forecast.totals.suggestedHours}h`} accent={accents[1]} />
            <StatTile
              label={forecast.totals.gapHours > 0 ? 'Understaffed' : forecast.totals.gapHours < 0 ? 'Overstaffed' : 'Gap'}
              value={`${Math.abs(forecast.totals.gapHours)}h`}
              accent={{ bg: `${gapColor}22`, fg: gapColor }}
            />
          </View>
        </Card.Content>
      </Card>

      {/* Alerts */}
      {forecast.alerts.length > 0 && (
        <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
          <Card.Content style={{ gap: 4 }}>
            <Text variant="titleMedium" style={{ fontWeight: '700', marginBottom: 4 }}>
              Alerts ({forecast.alerts.length})
            </Text>
            {forecast.alerts.map((alert, i) => (
              <AlertRow key={i} alert={alert} />
            ))}
          </Card.Content>
        </Card>
      )}

      {/* Daily demand bars */}
      <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
        <Card.Content style={{ gap: 0 }}>
          <Text variant="titleMedium" style={{ fontWeight: '700', marginBottom: 4 }}>
            Daily Demand
          </Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
            Bar = scheduled ÷ suggested hours. Daypart chips show covers and staff in each window.
          </Text>
          {forecast.days.map((day) => (
            <DayBar key={day.dayIndex} day={day} />
          ))}
        </Card.Content>
      </Card>

      {/* OT watch */}
      {forecast.otRisk.length > 0 && (
        <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
          <Card.Content style={{ gap: 4 }}>
            <Text variant="titleMedium" style={{ fontWeight: '700', marginBottom: 4 }}>Overtime Watch</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
              Staff scheduled ≥ 32h this week. Adjust shifts to avoid overtime.
            </Text>
            {forecast.otRisk.map((risk) => (
              <OTRow key={risk.name} risk={risk} />
            ))}
          </Card.Content>
        </Card>
      )}

      {forecast.otRisk.length === 0 && forecast.alerts.length === 0 && (
        <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
          <Card.Content style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <MaterialCommunityIcons name="check-circle" size={20} color={colors.success} />
            <Text style={{ color: colors.muted }}>No staffing alerts this week.</Text>
          </Card.Content>
        </Card>
      )}
    </View>
  );
}
