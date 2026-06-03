import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { TextInput } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CommandButton, CommandSurface, CommandText, StatusPill } from './FutureUI';
import type { DesignPalette } from '../lib/theme';
import { spacing } from '../lib/theme';

type InsightSnapshot = {
  scheduledShifts: number;
  openShifts: number;
  activeClocks: number;
  lateOrMissedAlerts: number;
  activeReservations: number;
  upcomingReservations: number;
  pendingRequests: number;
} | null | undefined;

type CopilotAction = {
  tone: 'good' | 'warn' | 'danger' | 'neutral';
  title: string;
  body: string;
};

function buildActions(insights: InsightSnapshot, dashboard: any): CopilotAction[] {
  const actions: CopilotAction[] = [];
  if (!insights) {
    actions.push({
      tone: 'neutral',
      title: 'Copilot is standing by',
      body: 'Connect venue data or sign in as a manager to unlock live operations recommendations.',
    });
    return actions;
  }

  if (insights.openShifts > 0) {
    actions.push({
      tone: 'warn',
      title: `${insights.openShifts} open shift${insights.openShifts === 1 ? '' : 's'}`,
      body: 'Review schedule coverage before service and assign open roles with the highest guest impact first.',
    });
  }
  if (insights.lateOrMissedAlerts > 0) {
    actions.push({
      tone: 'danger',
      title: `${insights.lateOrMissedAlerts} clock alert${insights.lateOrMissedAlerts === 1 ? '' : 's'}`,
      body: 'Check long-running or missed clock entries so labor reporting stays clean.',
    });
  }
  if (insights.pendingRequests > 0) {
    actions.push({
      tone: 'warn',
      title: `${insights.pendingRequests} staff request${insights.pendingRequests === 1 ? '' : 's'} pending`,
      body: 'Approve or deny pending time-off and availability changes before publishing the next schedule.',
    });
  }
  if (insights.upcomingReservations > 0) {
    actions.push({
      tone: 'good',
      title: `${insights.upcomingReservations} reservation${insights.upcomingReservations === 1 ? '' : 's'} in 24 hours`,
      body: 'Scan VIP notes, large parties, and event prep while the floor plan is still easy to adjust.',
    });
  }
  if ((dashboard?.analytics?.clockedInCount ?? insights.activeClocks) === 0 && insights.scheduledShifts > 0) {
    actions.push({
      tone: 'neutral',
      title: 'No one clocked in yet',
      body: 'Service is quiet right now. Prep the manager checklist and confirm first-wave staffing.',
    });
  }
  if (actions.length === 0) {
    actions.push({
      tone: 'good',
      title: 'Operations look steady',
      body: 'No urgent staffing, clock, or request issues detected. Keep an eye on arrivals and guest notes.',
    });
  }
  return actions.slice(0, 4);
}

function answerQuestion(question: string, insights: InsightSnapshot) {
  const q = question.trim().toLowerCase();
  if (!q) return 'Ask about staffing, reservations, clock alerts, or manager requests.';
  if (!insights) return 'I need manager operations data before I can answer that.';
  if (q.includes('staff') || q.includes('shift') || q.includes('coverage')) {
    return `${insights.scheduledShifts} shifts are scheduled, ${insights.openShifts} are open, and ${insights.activeClocks} people are clocked in.`;
  }
  if (q.includes('clock') || q.includes('late') || q.includes('labor')) {
    return `${insights.lateOrMissedAlerts} clock alert${insights.lateOrMissedAlerts === 1 ? '' : 's'} need review.`;
  }
  if (q.includes('reservation') || q.includes('guest') || q.includes('party')) {
    return `${insights.activeReservations} reservations are active, with ${insights.upcomingReservations} coming in the next 24 hours.`;
  }
  if (q.includes('request') || q.includes('time off') || q.includes('approval')) {
    return `${insights.pendingRequests} staff request${insights.pendingRequests === 1 ? '' : 's'} are waiting for manager review.`;
  }
  return 'I can help with staffing coverage, clock alerts, reservation readiness, and pending staff requests from the live dashboard data.';
}

export function AiCopilotPanel({
  palette,
  insights,
  dashboard,
  onClose,
}: {
  palette: DesignPalette;
  insights: InsightSnapshot;
  dashboard: any;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('Ask me what needs attention before service.');
  const actions = useMemo(() => buildActions(insights, dashboard), [dashboard, insights]);

  const ask = () => setAnswer(answerQuestion(question, insights));

  return (
    <CommandSurface palette={palette} strong style={{ gap: spacing.md, borderColor: palette.primary }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
        <View style={{ flex: 1, minWidth: 220 }}>
          <CommandText palette={palette} variant="label">AI Copilot</CommandText>
          <CommandText palette={palette} variant="title">Active operations assistant</CommandText>
          <CommandText palette={palette} variant="caption">Live recommendations from schedule, clocks, reservations, and manager requests.</CommandText>
        </View>
        <CommandButton palette={palette} icon="close" onPress={onClose}>Close</CommandButton>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {actions.map((action) => (
          <View key={action.title} style={{ flexGrow: 1, flexBasis: 220, gap: spacing.xs, padding: spacing.md, borderRadius: 10, backgroundColor: palette.surfaceSoft }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <MaterialCommunityIcons name={action.tone === 'danger' ? 'alert-circle-outline' : action.tone === 'warn' ? 'alert-outline' : 'check-circle-outline'} size={18} color={action.tone === 'danger' ? palette.danger : action.tone === 'warn' ? palette.warning : palette.primary} />
              <StatusPill palette={palette} tone={action.tone}>{action.tone}</StatusPill>
            </View>
            <CommandText palette={palette} variant="body">{action.title}</CommandText>
            <CommandText palette={palette} variant="caption">{action.body}</CommandText>
          </View>
        ))}
      </View>

      <View style={{ gap: spacing.sm }}>
        <TextInput
          label="Ask Copilot"
          value={question}
          onChangeText={setQuestion}
          mode="outlined"
          outlineColor={palette.border}
          activeOutlineColor={palette.primary}
          textColor={palette.charcoal}
          placeholder="How is staffing? Any clock alerts?"
          placeholderTextColor={palette.muted}
          style={{ backgroundColor: palette.surfaceSoft }}
          onSubmitEditing={ask}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }}>
          <CommandButton palette={palette} icon="creation" onPress={ask}>Ask</CommandButton>
          <CommandText palette={palette} variant="caption" style={{ flex: 1 }}>{answer}</CommandText>
        </View>
      </View>
    </CommandSurface>
  );
}
