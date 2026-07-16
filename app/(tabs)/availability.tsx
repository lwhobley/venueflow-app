import { ScrollView } from 'react-native';
import { colors, spacing } from '../../lib/theme';
import { SectionHeader } from '../../components/AppCard';
import { AvailabilityEditor } from '../../components/schedule/AvailabilityEditor';
import { useI18n } from '../../lib/i18n';

export default function AvailabilityScreen() {
  const { t } = useI18n();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <SectionHeader kicker={t('availability.kicker')} title={t('availability.title')} subtitle={t('availability.subtitle')} />
      <AvailabilityEditor />
    </ScrollView>
  );
}
