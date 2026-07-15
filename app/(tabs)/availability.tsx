import { ScrollView } from 'react-native';
import { colors, spacing } from '../../lib/theme';
import { SectionHeader } from '../../components/AppCard';
import { AvailabilityEditor } from '../../components/schedule/AvailabilityEditor';

export default function AvailabilityScreen() {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <SectionHeader kicker="Schedule" title="Availability" subtitle="Tell your managers when you can work." />
      <AvailabilityEditor />
    </ScrollView>
  );
}
