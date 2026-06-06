import { useMemo } from 'react';
import { View } from 'react-native';
import { Card, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '../lib/railway-hooks';
import { api } from '../lib/railway-api';
import { accents, colors, spacing } from '../lib/theme';

type Insight = { kind: string; title: string; body: string };

const JOKES: Insight[] = [
  { kind: 'Joke', title: 'On the rocks', body: 'Why did the espresso file a police report? It got mugged.' },
  { kind: 'Joke', title: 'Service humor', body: "A waiter asks, 'How did you find your steak?' Guest: 'I just moved the potato and there it was.'" },
  { kind: 'Joke', title: 'Bar humor', body: 'I told the bartender a joke about a martini. He did not get it; it went over dry.' },
];

const FACTS: Insight[] = [
  { kind: 'F&B Fact', title: 'Champagne pressure', body: 'A sealed bottle of Champagne holds about 90 psi, roughly three times the pressure in a car tire.' },
  { kind: 'F&B Fact', title: 'Why we swirl wine', body: 'Swirling aerates wine and releases aroma compounds, so guests smell and taste more.' },
  { kind: 'F&B Fact', title: 'Umami', body: 'Umami comes from glutamates, which are abundant in parmesan, tomatoes, mushrooms, and soy.' },
];

const TIPS: Insight[] = [
  {
    kind: 'Trade Tip',
    title: 'Steps of service',
    body: 'Greet quickly, suggest drinks, mark the table, check back after two bites or two minutes, pre-bus often, offer dessert, and thank guests by name.',
  },
  {
    kind: 'Trade Tip',
    title: 'Table maintenance',
    body: 'Pre-bus continuously, refill before glasses are empty, and clear visual clutter before dessert. Anticipation beats reaction.',
  },
  {
    kind: 'Trade Tip',
    title: 'Bartender flow',
    body: 'Shake drinks with citrus, dairy, or egg. Stir clear spirit-forward cocktails. Express citrus oils over the glass before serving.',
  },
];

function pick<T>(arr: T[], windowIndex: number, salt: number) {
  return arr[(windowIndex + salt) % arr.length];
}

export function CosmicInsights() {
  const aiInsights = useQuery(api.cosmicInsights.getLatestInsights, {});
  const items = useMemo<Insight[]>(() => {
    if (aiInsights && aiInsights.length > 0) return aiInsights;
    const windowIndex = Math.floor(Date.now() / (8 * 60 * 60 * 1000));
    return [pick(TIPS, windowIndex, 0), pick(FACTS, windowIndex, 1), pick(JOKES, windowIndex, 2)];
  }, [aiInsights]);

  return (
    <Card style={{ backgroundColor: colors.surface, borderRadius: 16 }}>
      <Card.Content style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <MaterialCommunityIcons name="creation" size={22} color={colors.primary} />
          <Text variant="titleMedium" style={{ color: colors.primary, fontWeight: '800' }}>Cosmic Insights</Text>
        </View>
        <Text style={{ color: colors.muted }}>Hospitality tips, F&B facts, and clean service humor refreshed through the day.</Text>
        {items.map((item, index) => {
          const accent = accents[index % accents.length];
          return (
            <View key={`${item.kind}-${item.title}`} style={{ backgroundColor: accent.bg, borderRadius: 12, padding: spacing.md, gap: 4 }}>
              <Text style={{ color: accent.fg, fontSize: 12, fontWeight: '800' }}>{item.kind}</Text>
              <Text style={{ color: colors.charcoal, fontWeight: '800' }}>{item.title}</Text>
              <Text style={{ color: colors.charcoal }}>{item.body}</Text>
            </View>
          );
        })}
      </Card.Content>
    </Card>
  );
}
