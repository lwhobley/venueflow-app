import { View } from 'react-native';
import { Card, Text } from 'react-native-paper';
import { colors, spacing } from '../../lib/theme';

export default function ChatScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
      <Card style={{ backgroundColor: colors.surface }}>
        <Card.Content style={{ gap: spacing.sm }}>
          <Text variant="headlineSmall">Chat</Text>
          <Text style={{ color: colors.muted }}>Venue chat and DMs will poll over HTTP every 3 seconds in the next pass.</Text>
        </Card.Content>
      </Card>
    </View>
  );
}
