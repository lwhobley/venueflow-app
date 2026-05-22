import { ScrollView, View } from 'react-native';
import { Text } from 'react-native-paper';
import { colors, spacing } from '../../lib/theme';
import { AvailabilityEditor } from '../../components/schedule/AvailabilityEditor';

export default function AvailabilityScreen() {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ gap: 4 }}>
        <Text variant="headlineMedium" style={{ color: colors.primary, fontWeight: '800' }}>
          Availability
        </Text>
        <Text style={{ color: colors.muted }}>Tell your managers when you can work.</Text>
      </View>
      <AvailabilityEditor />
    </ScrollView>
  );
}
