import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { CommandText } from './FutureUI';
import { spacing, useDesignTheme } from '../lib/theme';
import { useAskWrangler, type WranglerSnapshot } from '../lib/useWrangler';

export function WranglerIntelligencePanel({ snapshot }: { snapshot: WranglerSnapshot }) {
  const palette = useDesignTheme();
  const ask = useAskWrangler();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);

  const submit = async (preset?: string) => {
    const value = (preset ?? question).trim();
    if (value.length < 2) return;
    const result = await ask.mutateAsync({ question: value });
    setAnswer(result.answer);
    if (preset) setQuestion(preset);
  };

  return (
    <View style={{ gap: spacing.lg }}>
      <View style={{ gap: spacing.sm }}>
        <CommandText palette={palette} variant="title">Service recap</CommandText>
        <CommandText palette={palette} variant="body">{snapshot.recap.headline}</CommandText>
        {snapshot.recap.unresolved.slice(0, 3).map((item) => <CommandText key={item.id} palette={palette} variant="caption">• {item.title} — {item.reason}</CommandText>)}
      </View>

      <View style={{ gap: spacing.sm }}>
        <CommandText palette={palette} variant="title">What Wrangler is seeing</CommandText>
        {snapshot.patterns.length ? snapshot.patterns.map((pattern) => (
          <View key={pattern.id} style={{ borderTopWidth: 1, borderColor: palette.divider, paddingTop: spacing.sm, gap: 2 }}>
            <CommandText palette={palette} variant="label">{pattern.title}</CommandText>
            <CommandText palette={palette} variant="caption">{pattern.detail}</CommandText>
          </View>
        )) : <CommandText palette={palette} variant="caption">No recurring pressure is visible in the current service picture.</CommandText>}
      </View>

      <View style={{ gap: spacing.sm }}>
        <CommandText palette={palette} variant="title">Ask Wrangler</CommandText>
        <CommandText palette={palette} variant="caption">Ask about the live operating picture. Answers are grounded in Venue Wrangler data, not invented venue folklore.</CommandText>
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          {['What needs attention?', 'How is staffing?', 'What should I fix next?'].map((preset) => (
            <Pressable key={preset} onPress={() => void submit(preset)} style={{ borderWidth: 1, borderColor: palette.border, paddingHorizontal: spacing.sm, paddingVertical: 7 }}>
              <CommandText palette={palette} variant="caption">{preset}</CommandText>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <TextInput value={question} onChangeText={setQuestion} placeholder="Ask about tonight's service…" placeholderTextColor={palette.muted} style={{ flex: 1, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: palette.muted }} onSubmitEditing={() => void submit()} />
          <Pressable onPress={() => void submit()} style={{ backgroundColor: '#7A5A35', justifyContent: 'center', paddingHorizontal: spacing.md }}>
            <CommandText palette={palette} variant="label" style={{ color: '#FFFFFF' }}>{ask.isPending ? 'ASKING…' : 'ASK'}</CommandText>
          </Pressable>
        </View>
        {answer ? <View style={{ backgroundColor: '#F8F3EA', padding: spacing.md }}><CommandText palette={palette} variant="body">{answer}</CommandText></View> : null}
      </View>
    </View>
  );
}
