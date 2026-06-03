import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Menu, Text } from 'react-native-paper';
import { colors, spacing } from '../lib/theme';

export type DatePreset = {
  key: string;
  label: string;        // full label shown in menu
  shortLabel: string;   // compact label shown on the button
  days: number;         // window size for backend queries that take windowDays
  startDate: string;    // YYYY-MM-DD
  endDate: string;      // YYYY-MM-DD
  startTs: number;      // ms timestamp — start of startDate (midnight local)
  endTs: number;        // ms timestamp — end of endDate (23:59:59 local)
};

function pad(n: number) {
  return n.toString().padStart(2, '0');
}
function toStr(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtShort(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function startOf(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function endOf(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
}

export function buildPresets(): DatePreset[] {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());
  const last7 = new Date(today);
  last7.setDate(today.getDate() - 6);
  const last30 = new Date(today);
  last30.setDate(today.getDate() - 29);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const todayFmt = fmtShort(today);
  const monthName = today.toLocaleDateString('en-US', { month: 'long' });

  return [
    {
      key: 'today',
      label: `Today · ${todayFmt}`,
      shortLabel: `Today · ${todayFmt}`,
      days: 1,
      startDate: toStr(today),
      endDate: toStr(today),
      startTs: startOf(today),
      endTs: endOf(today),
    },
    {
      key: 'yesterday',
      label: `Yesterday · ${fmtShort(yesterday)}`,
      shortLabel: `Yesterday · ${fmtShort(yesterday)}`,
      days: 1,
      startDate: toStr(yesterday),
      endDate: toStr(yesterday),
      startTs: startOf(yesterday),
      endTs: endOf(yesterday),
    },
    {
      key: 'this_week',
      label: `This week · ${fmtShort(weekStart)}–${todayFmt}`,
      shortLabel: `This week`,
      days: today.getDay() + 1 || 7,
      startDate: toStr(weekStart),
      endDate: toStr(today),
      startTs: startOf(weekStart),
      endTs: endOf(today),
    },
    {
      key: 'last_7',
      label: `Last 7 days · ${fmtShort(last7)}–${todayFmt}`,
      shortLabel: 'Last 7 days',
      days: 7,
      startDate: toStr(last7),
      endDate: toStr(today),
      startTs: startOf(last7),
      endTs: endOf(today),
    },
    {
      key: 'last_30',
      label: `Last 30 days · ${fmtShort(last30)}–${todayFmt}`,
      shortLabel: 'Last 30 days',
      days: 30,
      startDate: toStr(last30),
      endDate: toStr(today),
      startTs: startOf(last30),
      endTs: endOf(today),
    },
    {
      key: 'this_month',
      label: `This month · ${monthName}`,
      shortLabel: monthName,
      days: today.getDate(),
      startDate: toStr(monthStart),
      endDate: toStr(today),
      startTs: startOf(monthStart),
      endTs: endOf(today),
    },
  ];
}

/** Hook that owns the selected preset. Presets refresh each calendar day. */
export function useDateRange(defaultKey = 'today') {
  const todayStr = toStr(new Date());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const presets = useMemo(buildPresets, [todayStr]);
  const [selected, setSelected] = useState<DatePreset>(
    () => presets.find((p) => p.key === defaultKey) ?? presets[0],
  );
  // Render-phase sync: when the calendar day rolls over, refresh the selected preset
  // so timestamps stay accurate without requiring a manual user interaction.
  const [lastToday, setLastToday] = useState(todayStr);
  if (lastToday !== todayStr) {
    setLastToday(todayStr);
    setSelected(presets.find((p) => p.key === selected.key) ?? presets[0]);
  }
  return { selected, setSelected, presets };
}

type Props = {
  selected: DatePreset;
  presets: DatePreset[];
  onSelect: (preset: DatePreset) => void;
};

export function DateRangeBar({ selected, presets, onSelect }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <Menu
        visible={open}
        onDismiss={() => setOpen(false)}
        anchor={
          <Button
            compact
            mode="outlined"
            icon="calendar-range"
            textColor={colors.primary}
            onPress={() => setOpen(true)}
          >
            {selected.shortLabel}
          </Button>
        }
      >
        {presets.map((preset) => (
          <Menu.Item
            key={preset.key}
            title={preset.label}
            leadingIcon={selected.key === preset.key ? 'check' : 'circle-outline'}
            onPress={() => {
              onSelect(preset);
              setOpen(false);
            }}
          />
        ))}
      </Menu>
      {selected.startDate !== selected.endDate ? (
        <Text style={{ color: colors.muted, fontSize: 12 }}>
          {selected.startDate} – {selected.endDate}
        </Text>
      ) : null}
    </View>
  );
}
